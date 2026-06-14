import { Hono } from 'hono';
import type { CreateTripInput, Trip } from '@life-os/shared-types';
import type { AppContext, Env } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';
import { googleFetch } from '../lib/google';

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
// Koleo/PKP have no public API — import is best-effort Gmail parsing only.
const TICKET_QUERY = 'from:(noreply@koleo.pl OR bilety@pkpintercity.pl) newer_than:1y';

export const tripsRouter = new Hono<AppContext>();
tripsRouter.use('*', requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapTrip(row: any): Trip {
  return {
    id: row.id,
    fromLoc: row.from_loc,
    toLoc: row.to_loc,
    departureAt: row.departure_at,
    arrivalAt: row.arrival_at ?? undefined,
    carrier: row.carrier ?? undefined,
    trainNumber: row.train_number ?? undefined,
    seat: row.seat ?? undefined,
    source: row.source,
    rawEmailId: row.raw_email_id ?? undefined,
    createdAt: row.created_at,
  };
}

// GET /api/trips
tripsRouter.get('/', async (c) => {
  const supabase = createSupabase(c.env);
  const { data, error } = await supabase
    .from('trips')
    .select('*')
    .order('departure_at', { ascending: false });
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json((data ?? []).map(mapTrip));
});

// POST /api/trips — manual entry.
tripsRouter.post('/', async (c) => {
  const body = await c.req.json<CreateTripInput>();
  if (!body.fromLoc?.trim() || !body.toLoc?.trim() || !body.departureAt) {
    return c.json({ error: 'from_to_departure_required' }, 400);
  }
  const supabase = createSupabase(c.env);
  const { data, error } = await supabase
    .from('trips')
    .insert({
      from_loc: body.fromLoc.trim(),
      to_loc: body.toLoc.trim(),
      departure_at: body.departureAt,
      arrival_at: body.arrivalAt ?? null,
      carrier: body.carrier ?? null,
      train_number: body.trainNumber ?? null,
      seat: body.seat ?? null,
      source: 'manual',
    })
    .select('*')
    .single();
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json(mapTrip(data), 201);
});

// --- Gmail import helpers (heuristic) ---

function b64urlToText(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? 4 - (b64.length % 4) : 0;
  const bin = atob(b64 + '='.repeat(pad));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return b64urlToText(payload.body.data);
  if (Array.isArray(payload.parts)) {
    for (const p of payload.parts) {
      const t = extractText(p);
      if (t) return t;
    }
  }
  if (payload.body?.data) return b64urlToText(payload.body.data);
  return '';
}

function plDateToIso(date: string, time: string): string | null {
  const m = date.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${time}:00`;
}

interface ParsedTrip {
  fromLoc?: string;
  toLoc?: string;
  departureAt?: string;
  carrier?: string;
  trainNumber?: string;
  seat?: string;
}

// TODO: tune these regexes against real Koleo / PKP IC ticket emails.
function parseTicket(text: string): ParsedTrip {
  const out: ParsedTrip = {};
  const relacja = text.match(/Relacja[:\s]+(.+?)\s*(?:→|->|—|-|\bdo\b)\s*(.+)/i);
  if (relacja) {
    out.fromLoc = relacja[1].trim();
    out.toLoc = relacja[2].split('\n')[0].trim();
  }
  const odjazd = text.match(/(?:Odjazd|Wyjazd)[:\s]+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})/i);
  if (odjazd) out.departureAt = plDateToIso(odjazd[1], odjazd[2]) ?? undefined;

  const train = text.match(/\b(IC|TLK|EIP|EIC|KM|REGIO)\s?(\d{3,5})\b/i);
  if (train) {
    out.trainNumber = `${train[1].toUpperCase()} ${train[2]}`;
    out.carrier = /EIP|EIC|IC|TLK/i.test(train[1]) ? 'PKP Intercity' : 'Koleje';
  }
  const seat = text.match(/Miejsce[:\s]+(\d+)/i);
  const wagon = text.match(/Wagon[:\s]+(\d+)/i);
  if (seat) out.seat = wagon ? `wagon ${wagon[1]}, miejsce ${seat[1]}` : `miejsce ${seat[1]}`;
  return out;
}

async function fetchMessageIds(env: Env, accountId: string): Promise<string[]> {
  const url = `${GMAIL}/messages?q=${encodeURIComponent(TICKET_QUERY)}&maxResults=15`;
  const res = await googleFetch(env, accountId, url);
  if (!res.ok) return [];
  const data = (await res.json()) as { messages?: { id: string }[] };
  return (data.messages ?? []).map((m) => m.id);
}

// POST /api/trips/import-email — scan Gmail, parse, insert new trips.
tripsRouter.post('/import-email', async (c) => {
  const accountId = c.get('session').sub;
  const supabase = createSupabase(c.env);

  const ids = await fetchMessageIds(c.env, accountId);
  if (ids.length === 0) return c.json({ imported: 0, skipped: 0, scanned: 0 });

  // Skip messages we already imported.
  const { data: existing } = await supabase
    .from('trips')
    .select('raw_email_id')
    .not('raw_email_id', 'is', null);
  const seen = new Set((existing ?? []).map((r) => r.raw_email_id as string));

  let imported = 0;
  let skipped = 0;
  for (const id of ids) {
    if (seen.has(id)) {
      skipped++;
      continue;
    }
    const res = await googleFetch(c.env, accountId, `${GMAIL}/messages/${id}?format=full`);
    if (!res.ok) {
      skipped++;
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msg = (await res.json()) as any;
    const parsed = parseTicket(extractText(msg.payload));
    if (!parsed.fromLoc || !parsed.toLoc || !parsed.departureAt) {
      skipped++;
      continue;
    }
    const { error } = await supabase.from('trips').insert({
      from_loc: parsed.fromLoc,
      to_loc: parsed.toLoc,
      departure_at: parsed.departureAt,
      carrier: parsed.carrier ?? null,
      train_number: parsed.trainNumber ?? null,
      seat: parsed.seat ?? null,
      source: 'gmail',
      raw_email_id: id,
    });
    if (error) skipped++;
    else imported++;
  }

  return c.json({ imported, skipped, scanned: ids.length });
});
