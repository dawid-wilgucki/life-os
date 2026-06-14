import { Hono } from 'hono';
import type { InboxItem } from '@life-os/shared-types';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';
import { googleFetch } from '../lib/google';

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const CAL_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export const inboxRouter = new Hono<AppContext>();
inboxRouter.use('*', requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapInbox(row: any): InboxItem {
  return {
    id: row.id,
    text: row.text,
    source: row.source,
    status: row.status,
    capturedAt: row.captured_at,
  };
}

// GET /api/inbox — default excludes archived; ?status=new|archived|converted|all.
inboxRouter.get('/', async (c) => {
  const supabase = createSupabase(c.env);
  const status = c.req.query('status');
  let q = supabase.from('inbox_items').select('*').order('captured_at', { ascending: false });
  if (status && status !== 'all') q = q.eq('status', status);
  else if (!status) q = q.neq('status', 'archived');
  const { data, error } = await q;
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json((data ?? []).map(mapInbox));
});

// POST /api/inbox — capture (also reachable from Telegram via the webhook).
inboxRouter.post('/', async (c) => {
  const body = await c.req.json<{ text: string; source?: string }>();
  if (!body.text?.trim()) return c.json({ error: 'text_required' }, 400);
  const supabase = createSupabase(c.env);
  const { data, error } = await supabase
    .from('inbox_items')
    .insert({ text: body.text.trim(), source: body.source ?? 'web', status: 'new' })
    .select('*')
    .single();
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json(mapInbox(data), 201);
});

// PATCH /api/inbox/:id — triage: archive | convert_task | convert_event.
inboxRouter.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const accountId = c.get('session').sub;
  const body = await c.req.json<{
    action: 'archive' | 'convert_task' | 'convert_event';
    listId?: string;
    due?: string;
    start?: string;
    end?: string;
  }>();

  const supabase = createSupabase(c.env);
  const { data: item } = await supabase.from('inbox_items').select('*').eq('id', id).single();
  if (!item) return c.json({ error: 'not_found' }, 404);

  if (body.action === 'archive') {
    await supabase.from('inbox_items').update({ status: 'archived' }).eq('id', id);
    return c.json({ ok: true });
  }

  if (body.action === 'convert_task') {
    if (!body.listId) return c.json({ error: 'listId_required' }, 400);
    const res = await googleFetch(
      c.env,
      accountId,
      `${TASKS_API}/lists/${encodeURIComponent(body.listId)}/tasks`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: item.text, due: body.due }),
      },
    );
    if (!res.ok) return c.json({ error: 'google_error', detail: await res.text() }, 502);
    await supabase.from('inbox_items').update({ status: 'converted' }).eq('id', id);
    return c.json({ ok: true });
  }

  if (body.action === 'convert_event') {
    if (!body.start || !body.end) return c.json({ error: 'start_end_required' }, 400);
    const allDay = body.start.length === 10; // YYYY-MM-DD
    const times = allDay
      ? { start: { date: body.start }, end: { date: body.end } }
      : { start: { dateTime: body.start }, end: { dateTime: body.end } };
    const res = await googleFetch(c.env, accountId, CAL_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ summary: item.text, ...times }),
    });
    if (!res.ok) return c.json({ error: 'google_error', detail: await res.text() }, 502);
    await supabase.from('inbox_items').update({ status: 'converted' }).eq('id', id);
    return c.json({ ok: true });
  }

  return c.json({ error: 'bad_action' }, 400);
});
