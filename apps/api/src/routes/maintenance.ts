import { Hono } from 'hono';
import type { CreateMaintenanceInput, MaintenanceItem } from '@life-os/shared-types';
import type { AppContext, Env } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';
import { googleFetch } from '../lib/google';

const CAL_BASE = 'https://www.googleapis.com/calendar/v3';
const MAINT_CALENDAR = 'Dom/Konserwacja';

export const maintenanceRouter = new Hono<AppContext>();
maintenanceRouter.use('*', requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapItem(row: any): MaintenanceItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    nextDue: row.next_due,
    intervalDays: row.interval_days,
    googleEventId: row.google_event_id ?? undefined,
    reminderSent: row.reminder_sent,
    createdAt: row.created_at,
  };
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Find (or create) the dedicated "Dom/Konserwacja" calendar.
async function getMaintCalendarId(env: Env, accountId: string): Promise<string | null> {
  const listRes = await googleFetch(env, accountId, `${CAL_BASE}/users/me/calendarList?maxResults=250`);
  if (listRes.ok) {
    const data = (await listRes.json()) as { items?: { id: string; summary: string }[] };
    const found = data.items?.find((cal) => cal.summary === MAINT_CALENDAR);
    if (found) return found.id;
  }
  const createRes = await googleFetch(env, accountId, `${CAL_BASE}/calendars`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ summary: MAINT_CALENDAR }),
  });
  if (!createRes.ok) return null;
  const cal = (await createRes.json()) as { id?: string };
  return cal.id ?? null;
}

async function upsertMaintEvent(
  env: Env,
  accountId: string,
  calId: string,
  name: string,
  dueYmd: string,
  eventId?: string,
): Promise<string | null> {
  const body = JSON.stringify({
    summary: `🔧 ${name}`,
    start: { date: dueYmd },
    end: { date: addDaysYmd(dueYmd, 1) },
  });
  const base = `${CAL_BASE}/calendars/${encodeURIComponent(calId)}/events`;
  const res = eventId
    ? await googleFetch(env, accountId, `${base}/${encodeURIComponent(eventId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body,
      })
    : await googleFetch(env, accountId, base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
  if (!res.ok) return null;
  const ev = (await res.json()) as { id?: string };
  return ev.id ?? eventId ?? null;
}

// GET /api/maintenance
maintenanceRouter.get('/', async (c) => {
  const supabase = createSupabase(c.env);
  const { data, error } = await supabase
    .from('maintenance_items')
    .select('*')
    .order('next_due', { ascending: true });
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json((data ?? []).map(mapItem));
});

// POST /api/maintenance
maintenanceRouter.post('/', async (c) => {
  const accountId = c.get('session').sub;
  const body = await c.req.json<CreateMaintenanceInput>();
  if (!body.name?.trim() || !body.category || !body.nextDue || !body.intervalDays) {
    return c.json({ error: 'missing_fields' }, 400);
  }

  let googleEventId: string | null = null;
  if (body.mirrorToCalendar) {
    const calId = await getMaintCalendarId(c.env, accountId);
    if (calId) googleEventId = await upsertMaintEvent(c.env, accountId, calId, body.name, body.nextDue);
  }

  const supabase = createSupabase(c.env);
  const { data, error } = await supabase
    .from('maintenance_items')
    .insert({
      name: body.name.trim(),
      category: body.category,
      next_due: body.nextDue,
      interval_days: body.intervalDays,
      google_event_id: googleEventId,
      reminder_sent: false,
    })
    .select('*')
    .single();
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json(mapItem(data), 201);
});

// PATCH /api/maintenance/:id — mark done: advance next_due by interval_days.
maintenanceRouter.patch('/:id', async (c) => {
  const accountId = c.get('session').sub;
  const id = c.req.param('id');
  const supabase = createSupabase(c.env);

  const { data: item } = await supabase.from('maintenance_items').select('*').eq('id', id).single();
  if (!item) return c.json({ error: 'not_found' }, 404);

  const newDue = addDaysYmd(todayYmd(), item.interval_days as number);

  // Best-effort: move the mirrored calendar event too.
  if (item.google_event_id) {
    const calId = await getMaintCalendarId(c.env, accountId);
    if (calId) {
      await upsertMaintEvent(
        c.env,
        accountId,
        calId,
        item.name as string,
        newDue,
        item.google_event_id as string,
      );
    }
  }

  const { data, error } = await supabase
    .from('maintenance_items')
    .update({ next_due: newDue, reminder_sent: false })
    .eq('id', id)
    .select('*')
    .single();
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json(mapItem(data));
});
