import { Hono } from 'hono';
import type { ListItem, ListWithItems, CreateListItemInput } from '@life-os/shared-types';
import type { AppContext, Env } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';
import { googleFetch } from '../lib/google';

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

// Sentinel id for the single virtual list that mirrors Google Tasks. It is not
// a Supabase row — its items live in Google and its position lives in KV — so
// the feature needs no database migration to work.
const GTASKS_ID = 'google-tasks';

export const listsRouter = new Hono<AppContext>();
listsRouter.use('*', requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toItem(row: any): ListItem {
  return {
    id: row.id,
    listId: row.list_id,
    text: row.text,
    checked: row.checked,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

// Map a Google Tasks task into our ListItem shape (id = Google task id).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function googleTaskToItem(g: any, googleListId: string): ListItem {
  return {
    id: g.id,
    listId: googleListId,
    text: g.title ?? '',
    checked: g.status === 'completed',
    sortOrder: 0,
    createdAt: g.updated ?? new Date().toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toList(row: any): ListWithItems {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    type: row.type ?? 'list',
    content: row.type === 'note' ? (row.content ?? undefined) : undefined,
    orderIndex: row.order_index ?? 0,
    locked: !!row.locked,
    source: 'local',
    createdAt: row.created_at,
    items: (row.list_items ?? []).map(toItem),
  };
}

// Resolve (and cache) the user's default Google Tasks list — the one we mirror.
async function resolveGoogleList(
  env: Env,
  accountId: string,
): Promise<{ id: string; title: string } | null> {
  const cached = await env.TOKENS.get(`gtasks_list:${accountId}`);
  if (cached) return JSON.parse(cached) as { id: string; title: string };

  const res = await googleFetch(env, accountId, `${TASKS_API}/users/@me/lists?maxResults=100`);
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: { id: string; title: string }[] };
  const first = data.items?.[0];
  if (!first) return null;

  const out = { id: first.id, title: first.title };
  await env.TOKENS.put(`gtasks_list:${accountId}`, JSON.stringify(out), { expirationTtl: 7 * 24 * 3600 });
  return out;
}

// Fetch open (incomplete) tasks for a Google list, mapped to ListItems.
async function fetchGoogleItems(
  env: Env,
  accountId: string,
  googleListId: string,
): Promise<ListItem[] | null> {
  const url =
    `${TASKS_API}/lists/${encodeURIComponent(googleListId)}/tasks` +
    `?showCompleted=false&maxResults=100`;
  const res = await googleFetch(env, accountId, url);
  if (!res.ok) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as { items?: any[] };
  return (data.items ?? [])
    .filter((g) => g.status !== 'completed')
    .map((g) => googleTaskToItem(g, googleListId));
}

// Build the virtual Google Tasks list (best-effort; null if Google is down).
async function buildGoogleList(env: Env, accountId: string): Promise<ListWithItems | null> {
  const gl = await resolveGoogleList(env, accountId);
  if (!gl) return null;

  const items = (await fetchGoogleItems(env, accountId, gl.id)) ?? [];
  const orderStr = await env.TOKENS.get(`gtasks_order:${accountId}`);
  // Defaults to -1 so the synced to-do list leads (and lands on the dashboard).
  const orderIndex = orderStr !== null ? Number(orderStr) : -1;

  return {
    id: GTASKS_ID,
    title: gl.title || 'Google Tasks',
    pinned: false,
    type: 'list',
    content: undefined,
    orderIndex,
    locked: true,
    source: 'google_tasks',
    createdAt: new Date(0).toISOString(),
    items,
  };
}

// GET /api/lists — local lists + the single virtual Google Tasks list, sorted.
listsRouter.get('/', async (c) => {
  const accountId = c.get('session').sub;
  const supabase = createSupabase(c.env);

  const { data, error } = await supabase
    .from('lists')
    .select('*, list_items(*)')
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);

  // Drop any stale google_tasks row from the earlier DB-backed approach.
  const lists = (data ?? [])
    .filter((r) => r.source !== 'google_tasks')
    .map(toList);

  const google = await buildGoogleList(c.env, accountId);
  if (google) lists.push(google);

  lists.sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt.localeCompare(b.createdAt));
  return c.json(lists);
});

// POST /api/lists — create a new local list or note.
listsRouter.post('/', async (c) => {
  const body = await c.req.json<{ title: string; pinned?: boolean; type?: 'list' | 'note'; content?: string }>();
  if (!body.title?.trim()) return c.json({ error: 'title_required' }, 400);
  const supabase = createSupabase(c.env);

  const { data: maxRow } = await supabase.from('lists').select('order_index').order('order_index', { ascending: false }).limit(1).maybeSingle();
  const orderIndex = (maxRow?.order_index ?? -1) + 1;

  const { data, error } = await supabase
    .from('lists')
    .insert({
      title: body.title.trim(),
      pinned: body.pinned ?? false,
      type: body.type ?? 'list',
      content: body.content ?? null,
      order_index: orderIndex,
    })
    .select('*, list_items(*)')
    .single();
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json(toList(data), 201);
});

// PATCH /api/lists/reorder — reorder lists by providing ordered array of IDs.
// The virtual Google list stores its position in KV; local lists in the DB.
listsRouter.patch('/reorder', async (c) => {
  const body = await c.req.json<{ ids: string[] }>();
  if (!Array.isArray(body.ids)) return c.json({ error: 'ids_required' }, 400);
  const accountId = c.get('session').sub;
  const supabase = createSupabase(c.env);
  await Promise.all(
    body.ids.map((id, index) =>
      id === GTASKS_ID
        ? c.env.TOKENS.put(`gtasks_order:${accountId}`, String(index))
        : supabase.from('lists').update({ order_index: index }).eq('id', id),
    ),
  );
  return c.json({ ok: true });
});

// PATCH /api/lists/:id — update note content or title (local lists only).
listsRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (id === GTASKS_ID) return c.json({ error: 'list_locked' }, 403);

  const body = await c.req.json<{ content?: string; title?: string; pinned?: boolean }>();
  const supabase = createSupabase(c.env);
  const update: Record<string, unknown> = {};
  if (body.content !== undefined) update['content'] = body.content;
  if (body.title !== undefined) update['title'] = body.title.trim();
  if (body.pinned !== undefined) update['pinned'] = body.pinned;
  if (Object.keys(update).length === 0) return c.json({ error: 'nothing_to_update' }, 400);

  const { error } = await supabase.from('lists').update(update).eq('id', id);
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json({ ok: true });
});

// POST /api/lists/:id/items — add item (proxied to Google for the synced list).
listsRouter.post('/:id/items', async (c) => {
  const listId = c.req.param('id');
  const body = await c.req.json<CreateListItemInput>();
  if (!body.text?.trim()) return c.json({ error: 'text_required' }, 400);

  if (listId === GTASKS_ID) {
    const accountId = c.get('session').sub;
    const gl = await resolveGoogleList(c.env, accountId);
    if (!gl) return c.json({ error: 'google_unavailable' }, 502);
    const res = await googleFetch(
      c.env,
      accountId,
      `${TASKS_API}/lists/${encodeURIComponent(gl.id)}/tasks`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: body.text.trim() }),
      },
    );
    if (!res.ok) return c.json({ error: 'google_error', detail: await res.text() }, 502);
    return c.json(googleTaskToItem(await res.json(), gl.id), 201);
  }

  const supabase = createSupabase(c.env);
  const { data, error } = await supabase
    .from('list_items')
    .insert({ list_id: listId, text: body.text.trim() })
    .select()
    .single();
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json(toItem(data), 201);
});

// PATCH /api/lists/:id/items/:itemId — toggle checked (proxied for synced list).
listsRouter.patch('/:id/items/:itemId', async (c) => {
  const listId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const body = await c.req.json<{ checked: boolean }>();

  if (listId === GTASKS_ID) {
    const accountId = c.get('session').sub;
    const gl = await resolveGoogleList(c.env, accountId);
    if (!gl) return c.json({ error: 'google_unavailable' }, 502);
    const patch: Record<string, unknown> = {
      status: body.checked ? 'completed' : 'needsAction',
    };
    if (!body.checked) patch['completed'] = null;
    const res = await googleFetch(
      c.env,
      accountId,
      `${TASKS_API}/lists/${encodeURIComponent(gl.id)}/tasks/${encodeURIComponent(itemId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) return c.json({ error: 'google_error', detail: await res.text() }, 502);
    return c.json(googleTaskToItem(await res.json(), gl.id));
  }

  const supabase = createSupabase(c.env);
  const { data, error } = await supabase
    .from('list_items')
    .update({ checked: body.checked })
    .eq('id', itemId)
    .select()
    .single();
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json(toItem(data));
});

// DELETE /api/lists/:id/items/:itemId (proxied for the synced list).
listsRouter.delete('/:id/items/:itemId', async (c) => {
  const listId = c.req.param('id');
  const itemId = c.req.param('itemId');

  if (listId === GTASKS_ID) {
    const accountId = c.get('session').sub;
    const gl = await resolveGoogleList(c.env, accountId);
    if (!gl) return c.json({ error: 'google_unavailable' }, 502);
    const res = await googleFetch(
      c.env,
      accountId,
      `${TASKS_API}/lists/${encodeURIComponent(gl.id)}/tasks/${encodeURIComponent(itemId)}`,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 404) {
      return c.json({ error: 'google_error', detail: await res.text() }, 502);
    }
    return c.body(null, 204);
  }

  const supabase = createSupabase(c.env);
  const { error } = await supabase.from('list_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.body(null, 204);
});

// DELETE /api/lists/:id — the synced Google Tasks list cannot be deleted.
listsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (id === GTASKS_ID) return c.json({ error: 'list_locked' }, 403);

  const supabase = createSupabase(c.env);
  const { error } = await supabase.from('lists').delete().eq('id', id);
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.body(null, 204);
});
