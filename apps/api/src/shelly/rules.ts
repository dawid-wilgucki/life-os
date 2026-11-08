import type { ShellyAlertRule, ShellyReading } from '@life-os/shared-types';
import type { ShellyError } from '../lib/shelly';
import { alertSettings, type DeviceRow, type PeriodRow, type SettingsRow, type StateRow } from './db';
import { fmtDateTime, fmtDuration, fmtTime, nightExpectation, type RunWindow } from './time';

/**
 * Stage-1 rules: none of them needs history-derived thresholds.
 * Each rule returns a verdict per poll; the episode logic (alerts.ts) turns
 * verdicts into one Telegram message per episode + a "back to normal" one.
 */

export type VerdictStatus = 'firing' | 'ok' | 'unknown';

export interface Verdict {
  deviceId: string | null;
  rule: ShellyAlertRule;
  status: VerdictStatus;
  severity?: 'critical' | 'warning';
  message?: string;
  resolveMessage?: string;
  details?: Record<string, unknown>;
  /** Consecutive "ok" verdicts needed to close an open episode. */
  resolveAfter: number;
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ERROR_PL: Record<string, string> = {
  overtemp: 'przegrzanie modułu',
  overpower: 'przekroczona moc',
  overvoltage: 'za wysokie napięcie',
  undervoltage: 'za niskie napięcie',
  overcurrent: 'przekroczony prąd',
};

export interface DeviceRuleInput {
  now: Date;
  device: DeviceRow;
  state: StateRow;
  reading: ShellyReading | null;
  online: boolean;
  active: boolean;
  /** offline_since before this observation (to report the outage length on recovery). */
  prevOfflineSince?: string | null;
  /** Break covering today (null = monitored normally). */
  inBreak: PeriodRow | null;
  lat: number;
  lon: number;
  /** Today's expected run window whose check is due now (runs schedule). */
  dueRun?: RunWindow | null;
  /** Wh used since dueRun.from (null = no data to judge). */
  dueRunEnergyWh?: number | null;
}

export function evaluateDevice(i: DeviceRuleInput): Verdict[] {
  const { device, state, reading, online, active, now } = i;
  const name = `<b>${escapeHtml(device.name)}</b>`;
  const id = device.id;
  const out: Verdict[] = [];

  // --- Break: only "working during break" is monitored -----------------------
  if (i.inBreak) {
    const watch = i.inBreak.alert_on_activity;
    if (watch && online && active) {
      const p = reading?.apowerW;
      out.push({
        deviceId: id,
        rule: 'break_activity',
        status: 'firing',
        severity: 'warning',
        message: `${name}: praca w okresie przerwy${p != null && device.has_power_meter ? ` (pobór ${Math.round(p)} W)` : ''}.`,
        resolveMessage: `${name}: praca zakończona.`,
        resolveAfter: 1,
      });
    } else {
      out.push({ deviceId: id, rule: 'break_activity', status: online ? 'ok' : 'unknown', resolveAfter: 1 });
    }
    return out;
  }
  out.push({ deviceId: id, rule: 'break_activity', status: 'ok', resolveAfter: 1 });

  // --- Offline -----------------------------------------------------------------
  if (online) {
    const since = i.prevOfflineSince ?? null;
    out.push({
      deviceId: id,
      rule: 'offline',
      status: 'ok',
      resolveAfter: 1,
      resolveMessage: since
        ? `${name}: znów online (przerwa: ${fmtDuration(now.getTime() - new Date(since).getTime())}).`
        : `${name}: znów online.`,
    });
  } else {
    const since = state.offline_since ? new Date(state.offline_since) : now;
    const hours = (now.getTime() - since.getTime()) / 3_600_000;
    out.push(
      hours >= device.offline_after_hours
        ? {
            deviceId: id,
            rule: 'offline',
            status: 'firing',
            severity: 'critical',
            message: `${name}: brak kontaktu od ${fmtDateTime(since)} (ponad ${device.offline_after_hours} h).`,
            resolveMessage: `${name}: znów online.`,
            details: { offlineSince: since.toISOString() },
            resolveAfter: 1,
          }
        : { deviceId: id, rule: 'offline', status: 'unknown', resolveAfter: 1 },
    );
  }

  // Everything below needs a fresh reading.
  if (!online || !reading) return out;
  const cfg = alertSettings(device);

  // --- Errors reported by the device itself -------------------------------------
  if (cfg.device_errors) {
    const errs = reading.errors;
    out.push(
      errs.length
        ? {
            deviceId: id,
            rule: 'device_error',
            status: 'firing',
            severity: 'critical',
            message: `${name}: urządzenie zgłasza błąd — ${errs.map((e) => ERROR_PL[e] ?? escapeHtml(e)).join(', ')}.`,
            resolveMessage: `${name}: błąd ustąpił.`,
            details: { errors: errs },
            resolveAfter: 1,
          }
        : { deviceId: id, rule: 'device_error', status: 'ok', resolveAfter: 1 },
    );
  }

  // --- Mains voltage outside EN 50160 (230 V ±10 %) for 2 samples --------------
  if (cfg.voltage && reading.voltageV !== null) {
    const v = reading.voltageV;
    const bad = v < cfg.voltage_min || v > cfg.voltage_max;
    out.push(
      bad && state.voltage_bad_streak >= 2
        ? {
            deviceId: id,
            rule: 'voltage',
            status: 'firing',
            severity: 'warning',
            message: `${name}: napięcie ${v.toFixed(1)} V poza zakresem ${cfg.voltage_min}–${cfg.voltage_max} V.`,
            resolveMessage: `${name}: napięcie wróciło do normy (${v.toFixed(1)} V).`,
            details: { voltage: v },
            resolveAfter: 2,
          }
        : { deviceId: id, rule: 'voltage', status: bad ? 'unknown' : 'ok', resolveAfter: 2, resolveMessage: `${name}: napięcie wróciło do normy (${v.toFixed(1)} V).` },
    );
  }

  const sched = device.schedule;

  // --- Lights: on at night, off during the day -----------------------------------
  if (sched?.type === 'night' && reading.output !== null) {
    const { expect, sunrise, sunset } = nightExpectation(now, i.lat, i.lon, sched.tolerance_min ?? 30);
    const on = reading.output;
    if (expect === 'unknown') {
      out.push({ deviceId: id, rule: 'schedule', status: 'unknown', resolveAfter: 1 });
    } else if ((expect === 'on') === on) {
      out.push({
        deviceId: id,
        rule: 'schedule',
        status: 'ok',
        resolveAfter: 1,
        resolveMessage: `${name}: znów zgodnie z harmonogramem.`,
      });
    } else {
      out.push({
        deviceId: id,
        rule: 'schedule',
        status: 'firing',
        severity: 'warning',
        message:
          expect === 'off'
            ? `${name}: włączone w dzień (wschód słońca ${sunrise ? fmtTime(sunrise) : '?'}).`
            : `${name}: wyłączone po zmroku (zachód słońca ${sunset ? fmtTime(sunset) : '?'}).`,
        resolveMessage: `${name}: znów zgodnie z harmonogramem.`,
        resolveAfter: 1,
      });
    }
  }

  // --- Run lasting too long (e.g. auto-off did not work) ---------------------------
  if (cfg.max_run_min) {
    if (active && state.active_since) {
      const runMs = now.getTime() - new Date(state.active_since).getTime();
      out.push(
        runMs > cfg.max_run_min * 60_000
          ? {
              deviceId: id,
              rule: 'run_too_long',
              status: 'firing',
              severity: 'critical',
              message: `${name}: praca bez przerwy od ${fmtDuration(runMs)} (od ${fmtTime(state.active_since)}, limit ${cfg.max_run_min} min).`,
              resolveMessage: `${name}: praca zakończona.`,
              details: { activeSince: state.active_since },
              resolveAfter: 1,
            }
          : { deviceId: id, rule: 'run_too_long', status: 'unknown', resolveAfter: 1 },
      );
    } else if (!active) {
      out.push({ deviceId: id, rule: 'run_too_long', status: 'ok', resolveAfter: 1 });
    }
  }

  // --- Scheduled run did not happen -----------------------------------------------
  if (sched?.type === 'runs' && i.dueRun) {
    const w = i.dueRun;
    const ranByState = state.last_active_at !== null && new Date(state.last_active_at).getTime() >= w.from.getTime();
    const energy = i.dueRunEnergyWh;
    const ranByEnergy = energy !== null && energy !== undefined && energy >= cfg.min_run_wh;
    if (ranByState || ranByEnergy || active) {
      out.push({
        deviceId: id,
        rule: 'missed_run',
        status: 'ok',
        resolveAfter: 1,
        resolveMessage: `${name}: znów pracuje zgodnie z harmonogramem.`,
      });
    } else if (device.has_power_meter && (energy === null || energy === undefined)) {
      out.push({ deviceId: id, rule: 'missed_run', status: 'unknown', resolveAfter: 1 });
    } else {
      out.push({
        deviceId: id,
        rule: 'missed_run',
        status: 'firing',
        severity: 'warning',
        message: `${name}: brak uruchomienia zgodnie z harmonogramem (oczekiwano ok. ${fmtTime(w.start)}${
          energy != null ? `, zużycie ${energy.toFixed(0)} Wh` : ''
        }).`,
        resolveMessage: `${name}: znów pracuje zgodnie z harmonogramem.`,
        details: { expectedAt: w.start.toISOString() },
        resolveAfter: 1,
      });
    }
  }

  return out;
}

const ERROR_KIND_PL: Record<string, string> = {
  rate_limit: 'limit zapytań',
  network: 'brak połączenia / timeout',
  http: 'błąd HTTP',
  bad_response: 'nieoczekiwana odpowiedź',
  auth: 'odmowa dostępu',
};

/** Health of the Shelly Cloud connection itself. */
export function evaluateApi(settings: SettingsRow, failures: number, error: ShellyError | null): Verdict {
  if (!error) {
    return {
      deviceId: null,
      rule: 'api',
      status: 'ok',
      resolveAfter: 1,
      resolveMessage: 'Połączenie z Shelly Cloud znów działa.',
    };
  }
  if (error.kind === 'auth' && error.message === 'invalid_auth_key') {
    return {
      deviceId: null,
      rule: 'api',
      status: 'firing',
      severity: 'critical',
      message:
        'Shelly Cloud odrzuca klucz API (auth_key). Klucz zmienia się po zmianie hasła konta Shelly — ' +
        'ustaw nowy: <code>wrangler secret put SHELLY_AUTH_KEY</code>.',
      resolveMessage: 'Połączenie z Shelly Cloud znów działa.',
      details: { kind: error.kind },
      resolveAfter: 1,
    };
  }
  if (failures >= settings.api_failure_threshold) {
    return {
      deviceId: null,
      rule: 'api',
      status: 'firing',
      severity: 'critical',
      message: `Shelly Cloud nie odpowiada poprawnie od ${failures} prób z rzędu (${ERROR_KIND_PL[error.kind] ?? error.kind}). Stan urządzeń nie jest aktualizowany.`,
      resolveMessage: 'Połączenie z Shelly Cloud znów działa.',
      details: { kind: error.kind, error: error.message.slice(0, 200) },
      resolveAfter: 1,
    };
  }
  return { deviceId: null, rule: 'api', status: 'unknown', resolveAfter: 1 };
}
