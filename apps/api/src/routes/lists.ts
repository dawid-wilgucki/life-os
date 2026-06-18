import { Hono } from 'hono';
import type { ListItem, ListWithItems, CreateListItemInput } from '@life-os/shared-types';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toList(row: any): ListWithItems {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    type: row.type ?? 'list',
    content: row.content ?? undefined,
    orderIndex: row.order_index ?? 0,
    createdAt: row.created_at,
    items: (row.list_items ?? []).map(toItem),
  };
}

// GET /api/lists — all lists with items, ordered by order_index then created_at
listsRouter.get('/', async (c) => {
  const supabase = createSupabase(c.env);
  const { data, error } = await supabase
    .from('lists')
    .select('*, list_items(*)')
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json((data ?? []).map(toList));
});

// POST /api/lists — create a new list or note
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

// PATCH /api/lists/reorder — reorder lists by providing ordered array of IDs
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

// PATCH /api/lists/:id — update note content or title
listsRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
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

// POST /api/lists/:id/items — add item to a list
listsRouter.post('/:id/items', async (c) => {
  const listId = c.req.param('id');
  const body = await c.req.json<CreateListItemInput>();
  if (!body.text?.trim()) return c.json({ error: 'text_required' }, 400);
  const supabase = createSupabase(c.env);
  const { data, error } = await supabase
    .from('list_items')
    .insert({ list_id: listId, text: body.text.trim() })
    .select()
    .single();
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json(toItem(data), 201);
});

// PATCH /api/lists/:id/items/:itemId — toggle checked
listsRouter.patch('/:id/items/:itemId', async (c) => {
  const itemId = c.req.param('itemId');
  const body = await c.req.json<{ checked: boolean }>();
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

// DELETE /api/lists/:id/items/:itemId
listsRouter.delete('/:id/items/:itemId', async (c) => {
  const itemId = c.req.param('itemId');
  const supabase = createSupabase(c.env);
  const { error } = await supabase.from('list_items').delete().eq('id', itemId);
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.body(null, 204);
});

// DELETE /api/lists/:id
listsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabase(c.env);
  const { error } = await supabase.from('lists').delete().eq('id', id);
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.body(null, 204);
});
