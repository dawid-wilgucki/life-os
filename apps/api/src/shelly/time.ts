import type { ShellySchedule } from '@life-os/shared-types';
import type { PeriodRow } from './db';

/** All calendar logic runs in the household's timezone. */
export const TZ = 'Europe/Warsaw';

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export interface LocalParts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  /** YYYY-MM-DD */
  date: string;
  /** MM-DD */
  md: string;
  /** ISO weekday, 1 = Monday … 7 = Sunday */
  isoDow: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function localParts(at: Date): LocalParts {
  const p: Record<string, string> = {};
  for (const part of partsFmt.formatToParts(at)) p[part.type] = part.value;
  const y = Number(p.year);
  const m = Number(p.month);
  const d = Number(p.day);
  const hh = Number(p.hour) % 24;
  const mm = Number(p.minute);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, hh, mm, date: `${y}-${pad(m)}-${pad(d)}`, md: `${pad(m)}-${pad(d)}`, isoDow: dow === 0 ? 7 : dow };
}

/** Local wall-clock time (Europe/Warsaw) -> UTC instant. */
export function zonedToUtc(y: number, m: number, d: number, hh = 0, mm = 0): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const p = localParts(new Date(guess));
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  return new Date(guess - (asUtc - guess));
}

/** Shift a YYYY-MM-DD date by whole days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function isoDowOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

/** "HH:MM" in Europe/Warsaw. */
export function fmtTime(at: Date | string): string {
  const p = localParts(typeof at === 'string' ? new Date(at) : at);
  return `${pad(p.hh)}:${pad(p.mm)}`;
}

/** "DD.MM HH:MM" in Europe/Warsaw. */
export function fmtDateTime(at: Date | string): string {
  const p = localParts(typeof at === 'string' ? new Date(at) : at);
  return `${pad(p.d)}.${pad(p.m)} ${pad(p.hh)}:${pad(p.mm)}`;
}

export function fmtDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (h < 48) return m ? `${h} h ${m} min` : `${h} h`;
  return `${Math.round(h / 24)} dni`;
}

// ---------------------------------------------------------------------------
// Sunrise / sunset (NOAA-style approximation, accurate to ~1–2 min).
// ---------------------------------------------------------------------------

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588;
const J2000 = 2_451_545;
const J0 = 0.0009;
const OBLIQUITY = RAD * 23.4397;

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
}

/** Sunrise and sunset (UTC instants) for a local calendar date. */
export function sunTimes(date: string, lat: number, lon: number): SunTimes {
  const [y, m, d] = date.split('-').map(Number);
  const noonMs = Date.UTC(y, m - 1, d, 12);
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const days = noonMs / DAY_MS - 0.5 + J1970 - J2000;
  const n = Math.round(days - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = RAD * (357.5291 + 0.98560028 * ds);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const jNoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const h0 = RAD * -0.833;
  const cosW = (Math.sin(h0) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW < -1 || cosW > 1) return { sunrise: null, sunset: null };
  const w = Math.acos(cosW);
  const a = J0 + (w + lw) / (2 * Math.PI) + n;
  const jSet = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const jRise = jNoon - (jSet - jNoon);
  const fromJ = (j: number) => new Date((j + 0.5 - J1970) * DAY_MS);
  return { sunrise: fromJ(jRise), sunset: fromJ(jSet) };
}

// ---------------------------------------------------------------------------
// Break periods
// ---------------------------------------------------------------------------

export function periodCovers(p: PeriodRow, date: string): boolean {
  if (p.recurring) {
    if (!p.start_md || !p.end_md) return false;
    const md = date.slice(5);
    return p.start_md <= p.end_md ? md >= p.start_md && md <= p.end_md : md >= p.start_md || md <= p.end_md;
  }
  if (!p.starts_on || !p.ends_on) return false;
  return date >= p.starts_on && date <= p.ends_on;
}

/** The break period covering `date` (local YYYY-MM-DD), if any. */
export function breakOn(periods: PeriodRow[] | undefined, date: string): PeriodRow | null {
  for (const p of periods ?? []) if (periodCovers(p, date)) return p;
  return null;
}

/** Last day of the break that covers `date` (chained overlapping breaks are followed). */
export function breakEnd(periods: PeriodRow[] | undefined, date: string): string | null {
  if (!breakOn(periods, date)) return null;
  let day = date;
  for (let i = 0; i < 400; i++) {
    const next = addDays(day, 1);
    if (!breakOn(periods, next)) return day;
    day = next;
  }
  return null; // break never ends (covers the whole year)
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export interface RunWindow {
  date: string;
  start: Date;
  /** Earliest moment the run may begin (start − tolerance). */
  from: Date;
  /** Latest moment the run should have finished (start + duration + tolerance). */
  to: Date;
}

/** Expected run on a local date, or null when the schedule does not run that day. */
export function runWindow(
  schedule: Extract<ShellySchedule, { type: 'runs' }>,
  date: string,
  lat: number,
  lon: number,
): RunWindow | null {
  if (!schedule.days?.includes(isoDowOf(date))) return null;
  let base: Date | null = null;
  if (schedule.at === 'time') {
    const [hh, mm] = (schedule.time ?? '00:00').split(':').map(Number);
    const [y, m, d] = date.split('-').map(Number);
    base = zonedToUtc(y, m, d, hh || 0, mm || 0);
  } else {
    const sun = sunTimes(date, lat, lon);
    base = schedule.at === 'sunset' ? sun.sunset : sun.sunrise;
  }
  if (!base) return null;
  const tol = (schedule.tolerance_min ?? 30) * 60_000;
  const start = new Date(base.getTime() + (schedule.offset_min ?? 0) * 60_000);
  return {
    date,
    start,
    from: new Date(start.getTime() - tol),
    to: new Date(start.getTime() + schedule.duration_min * 60_000 + tol),
  };
}

/** Next expected run at or after `now` within a week (skipping break days). */
export function nextRun(
  schedule: Extract<ShellySchedule, { type: 'runs' }>,
  now: Date,
  lat: number,
  lon: number,
  periods?: PeriodRow[],
): Date | null {
  const today = localParts(now).date;
  for (let i = 0; i < 8; i++) {
    const date = addDays(today, i);
    if (breakOn(periods, date)) continue;
    const w = runWindow(schedule, date, lat, lon);
    if (w && w.start.getTime() >= now.getTime()) return w.start;
  }
  return null;
}

export type NightExpectation = 'on' | 'off' | 'unknown';

/** Lights expected on from sunset to sunrise; transitions (± tolerance) are "unknown". */
export function nightExpectation(
  now: Date,
  lat: number,
  lon: number,
  toleranceMin: number,
): { expect: NightExpectation; sunrise: Date | null; sunset: Date | null } {
  const today = localParts(now).date;
  const { sunrise, sunset } = sunTimes(today, lat, lon);
  if (!sunrise || !sunset) return { expect: 'unknown', sunrise, sunset };
  const tol = toleranceMin * 60_000;
  const t = now.getTime();
  let expect: NightExpectation = 'unknown';
  if (t >= sunrise.getTime() + tol && t <= sunset.getTime() - tol) expect = 'off';
  else if (t >= sunset.getTime() + tol || t <= sunrise.getTime() - tol) expect = 'on';
  return { expect, sunrise, sunset };
}

const DOW_PL = ['', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb', 'nd'];

export function describeSchedule(schedule: ShellySchedule): string {
  if (schedule.type === 'night') return 'Od zachodu do wschodu słońca';
  const days = schedule.days.length === 7 ? 'codziennie' : schedule.days.map((d) => DOW_PL[d] ?? d).join(', ');
  const off = schedule.offset_min ?? 0;
  const offTxt = off ? ` ${off > 0 ? '+' : '−'}${Math.abs(off)} min` : '';
  const at =
    schedule.at === 'time' ? `o ${schedule.time}` : schedule.at === 'sunrise' ? `wschód słońca${offTxt}` : `zachód słońca${offTxt}`;
  return `${days} · ${at} · ${schedule.duration_min} min`;
}

/** Is the local wall-clock time inside [from, to) (wrapping past midnight)? */
export function inQuietHours(now: Date, from: string, to: string): boolean {
  const p = localParts(now);
  const cur = p.hh * 60 + p.mm;
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const a = toMin(from);
  const b = toMin(to);
  if (a === b) return false;
  return a < b ? cur >= a && cur < b : cur >= a || cur < b;
}
