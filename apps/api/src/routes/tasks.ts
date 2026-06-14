import { Hono } from 'hono';
import type { Task, TaskList, TaskListWithMeta } from '@life-os/shared-types';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';
import { googleFetch } from '../lib/google';
import { createSupabase } from '../lib/supabase';

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';

export const tasksRouter = new Hono<AppContext>();
tasksRouter.use('*', requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTask(g: any): Task {
  return {
    id: g.id,
    title: g.title ?? '',
    notes: g.notes,
    status: g.status === 'completed' ? 'completed' : 'needsAction',
    due: g.due,
    completed: g.completed,
    position: g.position,
    parent: g.parent,
    updated: g.updated,
  };
}

// GET /api/tasks/lists — Google lists merged with local UI metadata.
tasksRouter.get('/lists', async (c) => {
  const accountId = c.get('session').sub;
  const res = await googleFetch(c.env, accountId, `${TASKS_API}/users/@me/lists?maxResults=100`);
  if (!res.ok) return c.json({ error: 'google_error', detail: await res.text() }, 502);
  const data = (await res.json()) as { items?: TaskList[] };

  const supabase = createSupabase(c.env);
  const { data: metas } = await supabase.from('task_list_meta').select('*');
  const metaById = new Map((metas ?? []).map((m) => [m.google_list_id as string, m]));

  const lists: TaskListWithMeta[] = (data.items ?? []).map((l) => {
    const m = metaById.get(l.id);
    return {
      id: l.id,
      title: l.title,
      updated: l.updated,
      meta: m
        ? {
            googleListId: m.google_list_id as string,
            color: (m.color as string) ?? null,
            pinned: !!m.pinned,
            sortOrder: (m.sort_order as number) ?? null,
          }
        : undefined,
    };
  });

  // Pinned first, then by sort_order, then title.
  lists.sort((a, b) => {
    const ap = a.meta?.pinned ? 1 : 0;
    const bp = b.meta?.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const ao = a.meta?.sortOrder ?? 9999;
    const bo = b.meta?.sortOrder ?? 9999;
    if (ao !== bo) return ao - bo;
    return a.title.localeCompare(b.title);
  });

  return c.json(lists);
});

// GET /api/tasks/lists/:id — tasks within a list.
tasksRouter.get('/lists/:id', async (c) => {
  const accountId = c.get('session').sub;
  const listId = c.req.param('id');
  const url =
    `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks` +
    `?showCompleted=true&showHidden=true&maxResults=100`;
  const res = await googleFetch(c.env, accountId, url);
  if (!res.ok) return c.json({ error: 'google_error', detail: await res.text() }, 502);
  const data = (await res.json()) as { items?: unknown[] };
  return c.json((data.items ?? []).map(mapTask));
});

// POST /api/tasks/lists/:id — create a task.
tasksRouter.post('/lists/:id', async (c) => {
  const accountId = c.get('session').sub;
  const listId = c.req.param('id');
  const body = await c.req.json<{ title: string; notes?: string; due?: string }>();
  if (!body.title?.trim()) return c.json({ error: 'title_required' }, 400);

  const res = await googleFetch(
    c.env,
    accountId,
    `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: body.title, notes: body.notes, due: body.due }),
    },
  );
  if (!res.ok) return c.json({ error: 'google_error', detail: await res.text() }, 502);
  return c.json(mapTask(await res.json()), 201);
});

// PATCH /api/tasks/lists/:id/:taskId — update / complete a task.
tasksRouter.patch('/lists/:id/:taskId', async (c) => {
  const accountId = c.get('session').sub;
  const listId = c.req.param('id');
  const taskId = c.req.param('taskId');
  const body = await c.req.json<{
    title?: string;
    notes?: string;
    status?: 'needsAction' | 'completed';
    due?: string | null;
  }>();

  // Clearing completion also clears the completed timestamp.
  const patch: Record<string, unknown> = { ...body };
  if (body.status === 'needsAction') patch['completed'] = null;

  const res = await googleFetch(
    c.env,
    accountId,
    `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) return c.json({ error: 'google_error', detail: await res.text() }, 502);
  return c.json(mapTask(await res.json()));
});

// DELETE /api/tasks/lists/:id/:taskId
tasksRouter.delete('/lists/:id/:taskId', async (c) => {
  const accountId = c.get('session').sub;
  const listId = c.req.param('id');
  const taskId = c.req.param('taskId');
  const res = await googleFetch(
    c.env,
    accountId,
    `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 404) {
    return c.json({ error: 'google_error', detail: await res.text() }, 502);
  }
  return c.body(null, 204);
});
