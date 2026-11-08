import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShellyReading } from '@life-os/shared-types';
import type { Env } from '../types';
import { createSupabase } from '../lib/supabase';
import { getDevicesStatus, ShellyError, shellyConfigured, type ShellyCloudDevice } from '../lib/shelly';
import { alertSettings, DEFAULT_SETTINGS, type AlertRow, type DeviceRow, type SettingsRow, type StateRow } from './db';
import { extractMeta, isActive, isOnline, normalizeReading, parseCloudUpdated, type DeviceMeta } from './normalize';
import { evaluateApi, evaluateDevice, type Verdict } from './rules';
import { applyVerdicts, sendPendingNotifications, type SilentResolve } from './alerts';
import { backfillStep } from './backfill';
import { addDays, breakOn, localParts, runWindow, type RunWindow } from './time';

export interface ShellyContext {
  devices: DeviceRow[];
  states: Map<string, StateRow>;
  settings: SettingsRow;
  openAlerts: AlertRow[];
}

export async function loadContext(db: SupabaseClient): Promise<ShellyContext> {
  const [dev, st, set, al] = await Promise.all([
    db.from('shelly_devices').select('*, shelly_device_periods(*)').order('sort_order').order('created_at'),
    db.from('shelly_device_state').select('*'),
    db.from('shelly_settings').select('*').eq('id', 1).maybeSingle(),
    db.from('shelly_alerts').select('*').is('resolved_at', null),
  ]);
  const err = dev.error ?? st.error ?? set.error ?? al.error;
  if (err) throw new Error(err.message);
  return {
    devices: (dev.data ?? []) as DeviceRow[],
    states: new Map(((st.data ?? []) as StateRow[]).map((s) => [s.device_id, s])),
    settings: (set.data as SettingsRow | null) ?? DEFAULT_SETTINGS,
    openAlerts: (al.data ?? []) as AlertRow[],
  };
}

/** Where the device computes its own sunrise/sunset (falls back to home). */
export function deviceLocation(device: DeviceRow, settings: SettingsRow): { lat: number; lon: number } {
  return {
    lat: device.latitude ?? settings.latitude,
    lon: device.longitude ?? settings.longitude,
  };
}

function emptyState(deviceId: string): StateRow {
  return {
    device_id: deviceId,
    online: false,
    output: null,
    last_reading: null,
    last_updated_raw: null,
    last_report_at: null,
    last_seen_online_at: null,
    offline_since: null,
    last_energy_wh: null,
    active_since: null,
    active_since_exact: false,
    active_energy_start_wh: null,
    last_active_at: null,
    last_run: null,
    voltage_bad_streak: 0,
    fw_version: null,
    fw_update: null,
    backfill_month: null,
    backfill_empty_months: 0,
    backfill_errors: 0,
    backfill_done: false,
  };
}

/** Polling-owned state columns (backfill columns are written separately). */
function pollStateColumns(s: StateRow, nowIso: string) {
  return {
    device_id: s.device_id,
    online: s.online,
    output: s.output,
    last_reading: s.last_reading,
    last_updated_raw: s.last_updated_raw,
    last_report_at: s.last_report_at,
    last_seen_online_at: s.last_seen_online_at,
    offline_since: s.offline_since,
    last_energy_wh: s.last_energy_wh,
    active_since: s.active_since,
    active_since_exact: s.active_since_exact,
    active_energy_start_wh: s.active_energy_start_wh,
    last_active_at: s.last_active_at,
    last_run: s.last_run,
    voltage_bad_streak: s.voltage_bad_streak,
    fw_version: s.fw_version,
    fw_update: s.fw_update,
    updated_at: nowIso,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

interface Observation {
  state: StateRow;
  reading: ShellyReading | null;
  online: boolean;
  active: boolean;
  meta: DeviceMeta | null;
}

/** Fold one cloud record into the device's running state. */
export function observe(device: DeviceRow, prev: StateRow | undefined, rec: ShellyCloudDevice | undefined, now: Date): Observation {
  const nowIso = now.toISOString();
  const s: StateRow = { ...(prev ?? emptyState(device.id)) };
  const online = isOnline(rec);
  const raw = rec?.status ? normalizeReading(rec.status, device.channel) : null;
  const reportAt = parseCloudUpdated(rec?.status?._updated);

  s.online = online;
  if (online) {
    s.last_seen_online_at = nowIso;
    s.offline_since = null;
  } else if (!s.offline_since) {
    // Gone between the last time it was seen online and now. Non-metering
    // devices report rarely, so `_updated` alone would date the outage too early.
    const lastSeen = s.last_seen_online_at ? new Date(s.last_seen_online_at).getTime() : null;
    const reported = reportAt ? reportAt.getTime() : null;
    const since = lastSeen ?? reported ?? now.getTime();
    s.offline_since = new Date(Math.max(since, reported ?? since)).toISOString();
  }
  if (typeof rec?.status?._updated === 'string') {
    s.last_updated_raw = rec.status._updated;
    if (reportAt) s.last_report_at = reportAt.toISOString();
  }

  const reading = online ? raw : null;
  const active = reading !== null && isActive(device, reading);
  if (reading) {
    s.output = reading.output;
    s.last_reading = reading;
    const cfg = alertSettings(device);
    if (reading.voltageV !== null) {
      const bad = reading.voltageV < cfg.voltage_min || reading.voltageV > cfg.voltage_max;
      s.voltage_bad_streak = bad ? Math.min(s.voltage_bad_streak + 1, 1000) : 0;
    }
    if (active) {
      if (!s.active_since) {
        const timerStart = reading.timerStartedAt ? new Date(reading.timerStartedAt * 1000) : null;
        const exact = timerStart !== null && timerStart.getTime() <= now.getTime();
        s.active_since = exact ? timerStart.toISOString() : nowIso;
        s.active_since_exact = exact;
        s.active_energy_start_wh = s.last_energy_wh ?? reading.energyTotalWh;
      }
      s.last_active_at = nowIso;
    } else if (s.active_since) {
      // The run ended somewhere between the previous observation and now.
      const energy =
        reading.energyTotalWh !== null && s.active_energy_start_wh !== null
          ? round1(Math.max(0, reading.energyTotalWh - s.active_energy_start_wh))
          : null;
      s.last_run = { start: s.active_since, end: nowIso, energyWh: energy, avgW: null, exact: false };
      s.active_since = null;
      s.active_since_exact = false;
      s.active_energy_start_wh = null;
    }
    if (reading.energyTotalWh !== null) s.last_energy_wh = reading.energyTotalWh;
  }

  const meta = rec ? extractMeta(rec, device.channel) : null;
  if (meta) {
    s.fw_version = meta.fwVersion ?? s.fw_version;
    s.fw_update = meta.fwUpdate ?? null;
  }
  return { state: s, reading, online, active, meta };
}

/** Device row columns to refresh from what the cloud reports. */
function metaPatch(device: DeviceRow, meta: DeviceMeta | null): Partial<DeviceRow> | null {
  if (!meta) return null;
  const patch: Partial<DeviceRow> = {};
  if (meta.modelCode && meta.modelCode !== device.model_code) patch.model_code = meta.modelCode;
  if (meta.gen && meta.gen !== device.gen) patch.gen = meta.gen;
  if (meta.hasPowerMeter !== undefined && meta.hasPowerMeter !== device.has_power_meter) {
    patch.has_power_meter = meta.hasPowerMeter;
  }
  const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
  if (meta.latitude !== undefined && meta.longitude !== undefined) {
    if (device.latitude === null || r4(device.latitude) !== r4(meta.latitude)) patch.latitude = r4(meta.latitude);
    if (device.longitude === null || r4(device.longitude) !== r4(meta.longitude)) patch.longitude = r4(meta.longitude);
  }
  return Object.keys(patch).length ? patch : null;
}

/** Today's (or yesterday's) run window whose "did it run?" check is due now. */
function dueRunWindow(device: DeviceRow, now: Date, lat: number, lon: number): RunWindow | null {
  const sched = device.schedule;
  if (sched?.type !== 'runs') return null;
  const today = localParts(now).date;
  for (const date of [today, addDays(today, -1)]) {
    const w = runWindow(sched, date, lat, lon);
    if (w && now.getTime() >= w.to.getTime() && now.getTime() < w.to.getTime() + 12 * 3_600_000) return w;
  }
  return null;
}

export interface PollOptions {
  source: 'poll' | 'live';
  backfill: boolean;
  notify: boolean;
}

export interface PollResult {
  ok: boolean;
  error?: string;
}

/**
 * One polling round: Shelly status -> samples + state -> rules -> episodes ->
 * Telegram -> (optionally) one bounded cloud-history backfill step.
 * Never throws: a broken poll must not affect other scheduled work.
 */
export async function runShellyPoll(env: Env, opts: PollOptions): Promise<PollResult> {
  if (!shellyConfigured(env)) {
    console.warn('[shelly] SHELLY_SERVER_URI / SHELLY_AUTH_KEY not configured — skipping');
    return { ok: false, error: 'not_configured' };
  }
  const db = createSupabase(env);
  const now = new Date();
  const nowIso = now.toISOString();

  let ctx: ShellyContext;
  try {
    ctx = await loadContext(db);
  } catch (err) {
    console.error('[shelly] loading context failed (migrations applied?)', err instanceof Error ? err.message : err);
    return { ok: false, error: 'db_unavailable' };
  }

  try {
    const { settings } = ctx;
    const enabled = ctx.devices.filter((d) => d.enabled);
    const today = localParts(now).date;

    // 1. One call for all devices (≤10 per call).
    let records: Map<string, ShellyCloudDevice> | null = null;
    let apiError: ShellyError | null = null;
    if (enabled.length) {
      try {
        const recs = await getDevicesStatus(env, enabled.map((d) => d.id));
        records = new Map(recs.map((r) => [r.id.toLowerCase(), r]));
      } catch (err) {
        apiError = err instanceof ShellyError ? err : new ShellyError('network', err instanceof Error ? err.message : String(err));
        console.error('[shelly] status call failed:', apiError.kind, apiError.message);
      }
    }

    // 2. Integration health.
    const failures = apiError ? settings.consecutive_failures + 1 : 0;
    const healthPatch = apiError
      ? { last_attempt_at: nowIso, consecutive_failures: failures, last_error: apiError.message.slice(0, 300), last_error_kind: apiError.kind }
      : { last_attempt_at: nowIso, consecutive_failures: 0, last_error: null, last_error_kind: null, last_success_at: nowIso };
    const writes: PromiseLike<unknown>[] = [db.from('shelly_settings').update(healthPatch).eq('id', 1).then((r) => r.error && console.error('[shelly] settings update failed', r.error.message))];

    const verdicts: Verdict[] = [evaluateApi(settings, failures, apiError)];
    const silent: SilentResolve[] = ctx.devices.filter((d) => !d.enabled).map((d) => ({ deviceId: d.id, resolution: 'disabled' as const }));
    const newStates = new Map(ctx.states);

    if (records) {
      // 3. Observe every enabled device.
      const observed = enabled.map((device) => {
        const obs = observe(device, ctx.states.get(device.id), records!.get(device.id), now);
        newStates.set(device.id, obs.state);
        return { device, obs };
      });

      const samples = observed
        .filter(({ obs }) => obs.reading)
        .map(({ device, obs }) => {
          const r = obs.reading!;
          return {
            device_id: device.id,
            ts: nowIso,
            source: opts.source,
            output: r.output,
            apower_w: r.apowerW,
            voltage_v: r.voltageV,
            current_a: r.currentA,
            freq_hz: r.freqHz,
            energy_total_wh: r.energyTotalWh,
            temp_c: r.tempC,
            rssi: r.rssi,
            uptime_s: r.uptimeS,
            errors: r.errors.length ? r.errors : null,
          };
        });

      if (samples.length) {
        const { error } = await db.from('shelly_samples').insert(samples);
        if (error) console.error('[shelly] samples insert failed', error.message);
      }
      writes.push(
        db
          .from('shelly_device_state')
          .upsert(observed.map(({ obs }) => pollStateColumns(obs.state, nowIso)), { onConflict: 'device_id' })
          .then((r) => r.error && console.error('[shelly] state upsert failed', r.error.message)),
      );
      for (const { device, obs } of observed) {
        const patch = metaPatch(device, obs.meta);
        if (patch) {
          Object.assign(device, patch);
          writes.push(db.from('shelly_devices').update(patch).eq('id', device.id).then((r) => r.error && console.error('[shelly] device meta update failed', r.error.message)));
        }
      }

      // 4. Rules.
      const dueChecks = await Promise.all(
        observed.map(async ({ device }) => {
          const { lat, lon } = deviceLocation(device, settings);
          const w = breakOn(device.shelly_device_periods, today) ? null : dueRunWindow(device, now, lat, lon);
          if (!w || !device.has_power_meter) return { w, energy: null as number | null };
          const { data, error } = await db.rpc('shelly_energy_between', {
            p_device: device.id,
            p_from: w.from.toISOString(),
            p_to: nowIso,
          });
          if (error) console.error('[shelly] energy_between failed', error.message);
          return { w, energy: error ? null : (data as number | null) };
        }),
      );

      observed.forEach(({ device, obs }, idx) => {
        const { lat, lon } = deviceLocation(device, settings);
        const inBreak = breakOn(device.shelly_device_periods, today);
        if (inBreak) silent.push({ deviceId: device.id, resolution: 'break', keepRules: ['break_activity'] });
        verdicts.push(
          ...evaluateDevice({
            now,
            device,
            state: obs.state,
            reading: obs.reading,
            online: obs.online,
            active: obs.active,
            prevOfflineSince: ctx.states.get(device.id)?.offline_since ?? null,
            inBreak,
            lat,
            lon,
            dueRun: dueChecks[idx].w,
            dueRunEnergyWh: dueChecks[idx].energy,
          }),
        );
      });
    } else {
      // No fresh data: only date-based silencing still applies.
      for (const device of enabled) {
        if (breakOn(device.shelly_device_periods, today)) {
          silent.push({ deviceId: device.id, resolution: 'break', keepRules: ['break_activity'] });
        }
      }
    }

    await Promise.all(writes);

    // 5. Episodes + Telegram.
    await applyVerdicts(db, verdicts, ctx.openAlerts, silent, now);
    if (opts.notify) {
      await sendPendingNotifications(env, db, settings, new Map(ctx.devices.map((d) => [d.id, d.name])), now);
    }

    // 6. Cloud history, a little at a time.
    if (opts.backfill && records) {
      await backfillStep(env, db, enabled, newStates, now);
    }
    return apiError ? { ok: false, error: apiError.kind } : { ok: true };
  } catch (err) {
    console.error('[shelly] poll failed', err instanceof Error ? err.stack ?? err.message : err);
    return { ok: false, error: 'internal' };
  }
}
