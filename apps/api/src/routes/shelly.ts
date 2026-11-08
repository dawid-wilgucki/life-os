import { Hono } from 'hono';
import type {
  CreateShellyDeviceInput,
  CreateShellyPeriodInput,
  ShellyOverview,
  ShellyRange,
  ShellySeries,
  ShellySeriesPoint,
  UpdateShellyDeviceInput,
} from '@life-os/shared-types';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';
import { getDevicesStatus, shellyConfigured } from '../lib/shelly';
import { toAlert, type AlertRow, type DeviceRow } from '../shelly/db';
import { extractMeta, type DeviceMeta } from '../shelly/normalize';
import { loadContext, runShellyPoll } from '../shelly/poll';
import { toDeviceView, toHealth } from '../shelly/view';
import { addDays, breakOn, localParts, zonedToUtc } from '../shelly/time';

export const shellyRouter = new Hono<AppContext>();
shellyRouter.use('*', requireAuth);

const MD_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[0-9a-f]{6,20}$/;

async function buildOverview(c: { env: AppContext['Bindings'] }): Promise<ShellyOverview> {
  const db = createSupabase(c.env);
  const ctx = await loadContext(db);
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data: recent, error } = await db
    .from('shelly_alerts')
    .select('*')
    .not('resolved_at', 'is', null)
    .gte('opened_at', since)
    .order('opened_at', { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);

  const now = new Date();
  const names = new Map(ctx.devices.map((d) => [d.id, d.name]));
  const nameOf = (a: AlertRow) => (a.device_id ? names.get(a.device_id) : undefined);
  return {
    devices: ctx.devices.map((d) => toDeviceView(d, ctx.states.get(d.id), ctx.settings, now)),
    openAlerts: [...ctx.openAlerts]
      .sort((a, b) => b.opened_at.localeCompare(a.opened_at))
      .map((a) => toAlert(a, nameOf(a))),
    recentAlerts: ((recent ?? []) as AlertRow[]).map((a) => toAlert(a, nameOf(a))),
    health: toHealth(ctx.settings, shellyConfigured(c.env)),
  };
}

// GET /api/shelly/overview — devices with state, alerts, integration health.
shellyRouter.get('/overview', async (c) => {
  try {
    return c.json(await buildOverview(c));
  } catch (err) {
    return c.json({ error: 'db_error', detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// POST /api/shelly/refresh — poll Shelly Cloud right now, then return the overview.
shellyRouter.post('/refresh', async (c) => {
  const result = await runShellyPoll(c.env, { source: 'live', backfill: false, notify: true });
  try {
    const overview = await buildOverview(c);
    return c.json({ ...overview, refresh: result });
  } catch (err) {
    return c.json({ error: 'db_error', detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /api/shelly/devices/:id/series?range=24h|30d|12m — energy + active time per bucket.
shellyRouter.get('/devices/:id/series', async (c) => {
  const id = c.req.param('id');
  const range = (c.req.query('range') ?? '24h') as ShellyRange;
  if (!['24h', '30d', '12m'].includes(range)) return c.json({ error: 'bad_range' }, 400);

  const db = createSupabase(c.env);
  const { data: device, error: devErr } = await db
    .from('shelly_devices')
    .select('*, shelly_device_periods(*)')
    .eq('id', id)
    .maybeSingle();
  if (devErr) return c.json({ error: 'db_error', detail: devErr.message }, 500);
  if (!device) return c.json({ error: 'not_found' }, 404);
  const dev = device as DeviceRow;

  const now = new Date();
  const lp = localParts(now);
  let from: Date;
  let to: Date;
  let bucket: ShellySeries['bucket'];
  if (range === '24h') {
    const hourStart = Math.floor(now.getTime() / 3_600_000) * 3_600_000;
    to = new Date(hourStart + 3_600_000);
    from = new Date(to.getTime() - 24 * 3_600_000);
    bucket = 'hour';
  } else if (range === '30d') {
    const [ty, tm, td] = addDays(lp.date, 1).split('-').map(Number);
    const [fy, fm, fd] = addDays(lp.date, -29).split('-').map(Number);
    to = zonedToUtc(ty, tm, td);
    from = zonedToUtc(fy, fm, fd);
    bucket = 'day';
  } else {
    const next = new Date(Date.UTC(lp.y, lp.m, 1));
    const first = new Date(Date.UTC(lp.y, lp.m - 12, 1));
    to = zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
    from = zonedToUtc(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
    bucket = 'month';
  }

  const args = { p_device: id, p_from: from.toISOString(), p_to: to.toISOString(), p_bucket: bucket };
  const [energy, activity] = await Promise.all([
    dev.has_power_meter ? db.rpc('shelly_energy_series', args) : Promise.resolve({ data: null, error: null }),
    db.rpc('shelly_activity_series', {
      ...args,
      p_use_power: dev.activity_signal === 'power',
      p_min_w: dev.active_power_min_w,
    }),
  ]);
  const rpcErr = energy.error ?? activity.error;
  if (rpcErr) return c.json({ error: 'db_error', detail: rpcErr.message }, 500);

  type EnergyRow = { bucket_start: string; wh: number | null; source: ShellySeriesPoint['source'] };
  type ActivityRow = { bucket_start: string; active_hours: number | null };
  const key = (s: string) => new Date(s).getTime();
  const energyBy = new Map(((energy.data ?? []) as EnergyRow[]).map((r) => [key(r.bucket_start), r]));
  const estimate = !dev.has_power_meter && dev.nominal_power_w ? dev.nominal_power_w : null;
  const periods = dev.shelly_device_periods ?? [];

  const points: ShellySeriesPoint[] = ((activity.data ?? []) as ActivityRow[]).map((a) => {
    const e = energyBy.get(key(a.bucket_start));
    const hours = a.active_hours === null ? null : Math.round(a.active_hours * 1000) / 1000;
    let wh = e?.wh ?? null;
    let source = e?.source ?? null;
    if (estimate !== null && hours !== null) {
      wh = hours * estimate;
      source = 'estimate';
    }
    const start = new Date(a.bucket_start);
    return {
      start: start.toISOString(),
      wh: wh === null ? null : Math.round(wh * 10) / 10,
      source,
      activeHours: hours,
      inBreak: bucket !== 'month' && breakOn(periods, localParts(start).date) !== null,
    };
  });

  const sum = (vals: Array<number | null>, decimals: number) => {
    const v = vals.filter((x): x is number => x !== null);
    const f = 10 ** decimals;
    return v.length ? Math.round(v.reduce((s, x) => s + x, 0) * f) / f : null;
  };
  const body: ShellySeries = {
    deviceId: id,
    range,
    bucket,
    points,
    totalWh: sum(points.map((p) => p.wh), 1),
    totalActiveHours: sum(points.map((p) => p.activeHours), 2),
    estimated: estimate !== null,
  };
  return c.json(body);
});

// POST /api/shelly/devices — add a device (capabilities auto-detected when the cloud knows it).
shellyRouter.post('/devices', async (c) => {
  const body = await c.req.json<CreateShellyDeviceInput>().catch(() => null);
  const id = body?.id?.trim().toLowerCase() ?? '';
  const name = body?.name?.trim() ?? '';
  if (!ID_RE.test(id)) return c.json({ error: 'bad_id' }, 400);
  if (!name) return c.json({ error: 'name_required' }, 400);

  let meta: DeviceMeta | null = null;
  if (shellyConfigured(c.env)) {
    try {
      const rec = (await getDevicesStatus(c.env, [id])).find((r) => r.id.toLowerCase() === id);
      if (rec) meta = extractMeta(rec, 0);
    } catch (err) {
      console.warn('[shelly] auto-detect failed', err instanceof Error ? err.message : err);
    }
  }

  const db = createSupabase(c.env);
  const { data: last } = await db.from('shelly_devices').select('sort_order').order('sort_order', { ascending: false }).limit(1);
  const { error } = await db.from('shelly_devices').insert({
    id,
    name,
    icon: body?.icon?.trim() || '🔌',
    has_power_meter: meta?.hasPowerMeter ?? body?.hasPowerMeter ?? false,
    activity_signal: body?.activitySignal === 'power' ? 'power' : 'output',
    nominal_power_w: body?.nominalPowerW ?? null,
    model_code: meta?.modelCode ?? null,
    gen: meta?.gen ?? null,
    latitude: meta?.latitude ?? null,
    longitude: meta?.longitude ?? null,
    sort_order: ((last?.[0]?.sort_order as number | undefined) ?? 0) + 1,
  });
  if (error) {
    if (error.code === '23505') return c.json({ error: 'already_exists' }, 409);
    return c.json({ error: 'db_error', detail: error.message }, 500);
  }
  return c.json({ id, detected: meta !== null }, 201);
});

// PATCH /api/shelly/devices/:id — editable settings.
shellyRouter.patch('/devices/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<UpdateShellyDeviceInput>().catch(() => null);
  if (!body) return c.json({ error: 'bad_body' }, 400);

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.icon === 'string' && body.icon.trim()) patch.icon = body.icon.trim();
  if (typeof body.hasPowerMeter === 'boolean') patch.has_power_meter = body.hasPowerMeter;
  if (body.activitySignal === 'output' || body.activitySignal === 'power') patch.activity_signal = body.activitySignal;
  if (typeof body.activePowerMinW === 'number' && body.activePowerMinW >= 0) patch.active_power_min_w = body.activePowerMinW;
  if (body.nominalPowerW === null || (typeof body.nominalPowerW === 'number' && body.nominalPowerW >= 0)) {
    patch.nominal_power_w = body.nominalPowerW || null;
  }
  if (typeof body.offlineAfterHours === 'number' && body.offlineAfterHours > 0) patch.offline_after_hours = body.offlineAfterHours;
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (!Object.keys(patch).length) return c.json({ error: 'nothing_to_update' }, 400);

  const db = createSupabase(c.env);
  const { data, error } = await db.from('shelly_devices').update(patch).eq('id', id).select('id');
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  if (!data?.length) return c.json({ error: 'not_found' }, 404);
  return c.body(null, 204);
});

// DELETE /api/shelly/devices/:id — removes the device with its history.
shellyRouter.delete('/devices/:id', async (c) => {
  const db = createSupabase(c.env);
  const { error } = await db.from('shelly_devices').delete().eq('id', c.req.param('id'));
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.body(null, 204);
});

// POST /api/shelly/devices/:id/periods — add a break period.
shellyRouter.post('/devices/:id/periods', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<CreateShellyPeriodInput>().catch(() => null);
  if (!body) return c.json({ error: 'bad_body' }, 400);

  const row: Record<string, unknown> = {
    device_id: id,
    recurring: Boolean(body.recurring),
    alert_on_activity: body.alertOnActivity ?? true,
    note: body.note?.trim() || null,
  };
  if (body.recurring) {
    if (!MD_RE.test(body.startMd ?? '') || !MD_RE.test(body.endMd ?? '')) return c.json({ error: 'bad_dates' }, 400);
    row.start_md = body.startMd;
    row.end_md = body.endMd;
  } else {
    if (!DATE_RE.test(body.startsOn ?? '') || !DATE_RE.test(body.endsOn ?? '') || body.endsOn! < body.startsOn!) {
      return c.json({ error: 'bad_dates' }, 400);
    }
    row.starts_on = body.startsOn;
    row.ends_on = body.endsOn;
  }

  const db = createSupabase(c.env);
  const { data, error } = await db.from('shelly_device_periods').insert(row).select('id').single();
  if (error) {
    if (error.code === '23503') return c.json({ error: 'not_found' }, 404);
    return c.json({ error: 'db_error', detail: error.message }, 500);
  }
  return c.json({ id: data.id }, 201);
});

// DELETE /api/shelly/periods/:periodId
shellyRouter.delete('/periods/:periodId', async (c) => {
  const db = createSupabase(c.env);
  const { error } = await db.from('shelly_device_periods').delete().eq('id', c.req.param('periodId'));
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.body(null, 204);
});
