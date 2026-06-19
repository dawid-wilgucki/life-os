import { Hono } from 'hono';
import type { ListItem, ListWithItems, CreateListItemInput } from '@life-os/shared-types';
import type { AppContext, Env } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';
import { googleFetch } from '../lib/google';

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

export const listsRouter = new Hono<AppContext>();
listsRouter.use('*', requireAuth);

type SupabaseClient = ReturnType<typeof createSupabase>;

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
    // For synced lists `content` holds the Google task-list id — never expose it.
    content: row.type === 'note' ? (row.content ?? undefined) : undefined,
    orderIndex: row.order_index ?? 0,
    locked: !!row.locked,
    source: (row.source ?? 'local') as 'local' | 'google_tasks',
    createdAt: row.created_at,
    items: (row.list_items ?? []).map(toItem),
  };
}

// Resolve the user's default Google Tasks list (the first one Google returns).
async function resolveDefaultGoogleList(
  env: Env,
  accountId: string,
): Promise<{ id: string; title: string } | null> {
  const res = await googleFetch(env, accountId, `${TASKS_API}/users/@me/lists?maxResults=100`);
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: { id: string; title: string }[] };
  const first = data.items?.[0];
  return first ? { id: first.id, title: first.title } : null;
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

// Ensure exactly one locked list mirrors Google Tasks. Best-effort: if Google
// is unavailable we simply skip and retry on the next load.
async function ensureGoogleList(
  supabase: SupabaseClient,
  env: Env,
  accountId: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from('lists')
    .select('id')
    .eq('source', 'google_tasks')
    .limit(1)
    .maybeSingle();
  if (existing) return;

  const def = await resolveDefaultGoogleList(env, accountId);
  if (!def) return;

  const { data: maxRow } = await supabase
    .from('lists')
    .select('order_index')
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  const orderIndex = (maxRow?.order_index ?? -1) + 1;

  // The partial unique index guards against duplicates under concurrent loads.
  await supabase.from('lists').insert({
    title: def.title || 'Google Tasks',
    pinned: false,
    type: 'list',
    content: def.id,
    order_index: orderIndex,
    locked: true,
    source: 'google_tasks',
  });
}

async function getListRow(
  supabase: SupabaseClient,
  id: string,
): Promise<{ source: string; content: string | null; locked: boolean } | null> {
  const { data } = await supabase
    .from('lists')
    .select('source, content, locked')
    .eq('id', id)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any) ?? null;
}

// GET /api/lists — all lists with items, ordered by order_index then created_at.
// The locked Google-Tasks list has its items hydrated live from Google.
listsRouter.get('/', async (c) => {
  const accountId = c.get('session').sub;
  const supabase = createSupabase(c.env);

  try {
    await ensureGoogleList(supabase, c.env, accountId);
  } catch (e) {
    console.error('ensureGoogleList failed:', e);
  }

  const { data, error } = await supabase
    .from('lists')
    .select('*, list_items(*)')
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);

  const rows = data ?? [];
  const lists = rows.map(toList);

  // Hydrate synced lists from Google Tasks in parallel (best-effort).
  await Promise.all(
    rows.map(async (row, i) => {
      if (row.source !== 'google_tasks' || !row.content) return;
      const items = await fetchGoogleItems(c.env, accountId, row.content);
      if (items) lists[i].items = items;
    }),
  );

  return c.json(lists);
});

// POST /api/lists — create a new local list or note.
listsRouter.post('/', async (c) => {
  const body = await c.req.json<{ title: string; pinned?: boolean; type?: 'list' | 'note'; content?: string }>();
  if (!body.title?.trim()) return c.json({ error: 'title_required' }, 400);
  const supabase = createSupabase(c.env);

  // Assign order_index = current max + 1.
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
listsRouter.patch('/reorder', async (c) => {
  const body = await c.req.json<{ ids: string[] }>();
  if (!Array.isArray(body.ids)) return c.json({ error: 'ids_required' }, 400);
  const supabase = createSupabase(c.env);
  await Promise.all(
    body.ids.map((id, index) =>
      supabase.from('lists').update({ order_index: index }).eq('id', id),
    ),
  );
  return c.json({ ok: true });
});

// PATCH /api/lists/:id — update note content or title.
listsRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ content?: string; title?: string; pinned?: boolean }>();
  const supabase = createSupabase(c.env);

  const update: Record<string, unknown> = {};
  if (body.content !== undefined) update['content'] = body.content;
  if (body.title !== undefined) update['title'] = body.title.trim();
  if (body.pinned !== undefined) update['pinned'] = body.pinned;
  if (Object.keys(update).length === 0) return c.json({ error: 'nothing_to_update' }, 400);

  // Never let a content edit clobber the Google list id stored on a synced list.
  if (update['content'] !== undefined) {
    const row = await getListRow(supabase, id);
    if (row?.source === 'google_tasks') delete update['content'];
    if (Object.keys(update).length === 0) return c.json({ ok: true });
  }

  const { error } = await supabase.from('lists').update(update).eq('id', id);
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json({ ok: true });
});

// POST /api/lists/:id/items — add item to a list (proxied to Google for synced lists).
listsRouter.post('/:id/items', async (c) => {
  const listId = c.req.param('id');
  const body = await c.req.json<CreateListItemInput>();
  if (!body.text?.trim()) return c.json({ error: 'text_required' }, 400);
  const supabase = createSupabase(c.env);

  const row = await getListRow(supabase, listId);
  if (row?.source === 'google_tasks' && row.content) {
    const accountId = c.get('session').sub;
    const res = await googleFetch(
      c.env,
      accountId,
      `${TASKS_API}/lists/${encodeURIComponent(row.content)}/tasks`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: body.text.trim() }),
      },
    );
    if (!res.ok) return c.json({ error: 'google_error', detail: await res.text() }, 502);
    return c.json(googleTaskToItem(await res.json(), row.content), 201);
  }

  const { data, error } = await supabase
    .from('list_items')
    .insert({ list_id: listId, text: body.text.trim() })
    .select()
    .single();
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json(toItem(data), 201);
});

// PATCH /api/lists/:id/items/:itemId — toggle checked (proxied for synced lists).
listsRouter.patch('/:id/items/:itemId', async (c) => {
  const listId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const body = await c.req.json<{ checked: boolean }>();
  const supabase = createSupabase(c.env);

  const row = await getListRow(supabase, listId);
  if (row?.source === 'google_tasks' && row.content) {
    const accountId = c.get('session').sub;
    const patch: Record<string, unknown> = {
      status: body.checked ? 'completed' : 'needsAction',
    };
    if (!body.checked) patch['completed'] = null;
    const res = await googleFetch(
      c.env,
      accountId,
      `${TASKS_API}/lists/${encodeURIComponent(row.content)}/tasks/${encodeURIComponent(itemId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) return c.json({ error: 'google_error', detail: await res.text() }, 502);
    return c.json(googleTaskToItem(await res.json(), row.content));
  }

  const { data, error } = await supabase
    .from('list_items')
    .update({ checked: body.checked })
    .eq('id', itemId)
    .select()
    .single();
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json(toItem(data));
});

// DELETE /api/lists/:id/items/:itemId (proxied for synced lists).
listsRouter.delete('/:id/items/:itemId', async (c) => {
  const listId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const supabase = createSupabase(c.env);

  const row = await getListRow(supabase, listId);
  if (row?.source === 'google_tasks' && row.content) {
    const accountId = c.get('session').sub;
    const res = await googleFetch(
      c.env,
      accountId,
      `${TASKS_API}/lists/${encodeURIComponent(row.content)}/tasks/${encodeURIComponent(itemId)}`,
      { method: 'DELETE' },
    );
    if (!res.ok && res.status !== 404) {
      return c.json({ error: 'google_error', detail: await res.text() }, 502);
    }
    return c.body(null, 204);
  }

  const { error } = await supabase.from('list_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.body(null, 204);
});

// DELETE /api/lists/:id — refused for locked (synced) lists.
listsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabase(c.env);

  const row = await getListRow(supabase, id);
  if (row?.locked) return c.json({ error: 'list_locked' }, 403);

  const { error } = await supabase.from('lists').delete().eq('id', id);
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.body(null, 204);
});
