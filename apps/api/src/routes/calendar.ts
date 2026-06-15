import { Hono } from 'hono';
import type { CalendarEvent, CreateEventInput } from '@life-os/shared-types';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';
import { googleFetch } from '../lib/google';

const CAL_BASE = 'https://www.googleapis.com/calendar/v3/calendars';
const CAL_API = `${CAL_BASE}/primary/events`;

export const calendarRouter = new Hono<AppContext>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapEvent(g: any): CalendarEvent {
  const allDay = !!g.start?.date;
  return {
    id: g.id,
    summary: g.summary ?? '(no title)',
    description: g.description,
    location: g.location,
    start: g.start?.dateTime ?? g.start?.date,
    end: g.end?.dateTime ?? g.end?.date,
    allDay,
    htmlLink: g.htmlLink,
  };
}

function toGoogleTimes(input: { start: string; end: string; allDay?: boolean }) {
  if (input.allDay) {
    return { start: { date: input.start }, end: { date: input.end } };
  }
  return { start: { dateTime: input.start }, end: { dateTime: input.end } };
}

// POST /api/calendar/webhook — Google push receiver. Public (Google signs it
// with the channel token). We read events live, so a push is just a hint.
// TODO(optional): use events.watch + calendar_sync_token to maintain a cache.
calendarRouter.post('/webhook', async (c) => {
  const state = c.req.header('X-Goog-Resource-State');
  console.log('calendar webhook', state, c.req.header('X-Goog-Channel-Id'));
  return c.body(null, 200);
});

// Everything else requires auth.
calendarRouter.use('*', requireAuth);

// GET /api/calendar/owners — list of calendars available to write events to
// (user's primary + configured parent calendars).
calendarRouter.get('/owners', (c) => {
  const owners = [{ id: 'primary', label: 'Ja' }];
  if (c.env.PARENT_MOM_CALENDAR_ID) {
    owners.push({ id: c.env.PARENT_MOM_CALENDAR_ID, label: 'Mama' });
  }
  if (c.env.PARENT_DAD_CALENDAR_ID) {
    owners.push({ id: c.env.PARENT_DAD_CALENDAR_ID, label: 'Tata' });
  }
  return c.json(owners);
});

// GET /api/calendar/events?start=&end= — events in a time window.
calendarRouter.get('/events', async (c) => {
  const accountId = c.get('session').sub;
  const now = new Date();
  const start =
    c.req.query('start') ?? new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const end =
    c.req.query('end') ?? new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();

  const url =
    `${CAL_API}?timeMin=${encodeURIComponent(start)}&timeMax=${encodeURIComponent(end)}` +
    `&singleEvents=true&orderBy=startTime&maxResults=2500`;
  const res = await googleFetch(c.env, accountId, url);
  if (!res.ok) return c.json({ error: 'google_error', detail: await res.text() }, 502);
  const data = (await res.json()) as { items?: unknown[] };
  return c.json((data.items ?? []).map(mapEvent));
});

// POST /api/calendar/events
// Accepts optional `calendarId` in the body to write to a shared calendar
// (e.g. a parent's calendar that has been shared with the user's account).
calendarRouter.post('/events', async (c) => {
  const accountId = c.get('session').sub;
  const body = await c.req.json<CreateEventInput>();
  if (!body.summary?.trim() || !body.start || !body.end) {
    return c.json({ error: 'summary_start_end_required' }, 400);
  }
  const calId = encodeURIComponent(body.calendarId ?? 'primary');
  const times = toGoogleTimes(body);
  const res = await googleFetch(c.env, accountId, `${CAL_BASE}/${calId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      summary: body.summary,
      description: body.description,
      location: body.location,
      ...times,
    }),
  });
  if (!res.ok) return c.json({ error: 'google_error', detail: await res.text() }, 502);
  return c.json(mapEvent(await res.json()), 201);
});

// PATCH /api/calendar/events/:id
calendarRouter.patch('/events/:id', async (c) => {
  const accountId = c.get('session').sub;
  const id = c.req.param('id');
  const body = await c.req.json<Partial<CreateEventInput>>();
  const patch: Record<string, unknown> = {
    summary: body.summary,
    description: body.description,
    location: body.location,
  };
  if (body.start && body.end) Object.assign(patch, toGoogleTimes(body as CreateEventInput));

  const res = await googleFetch(c.env, accountId, `${CAL_API}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) return c.json({ error: 'google_error', detail: await res.text() }, 502);
  return c.json(mapEvent(await res.json()));
});

// DELETE /api/calendar/events/:id
calendarRouter.delete('/events/:id', async (c) => {
  const accountId = c.get('session').sub;
  const id = c.req.param('id');
  const res = await googleFetch(c.env, accountId, `${CAL_API}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    return c.json({ error: 'google_error', detail: await res.text() }, 502);
  }
  return c.body(null, 204);
});
