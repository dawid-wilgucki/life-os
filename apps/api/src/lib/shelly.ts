import type { Env } from '../types';

/**
 * Shelly Cloud Control API client (auth_key flavour).
 *
 * Verified against the live account:
 *   POST /v2/devices/api/get?auth_key=…  body {"ids":[…≤10],"select":["status","settings"]}
 *     -> JSON array of {id, type, code, gen, online, status, settings}
 *   GET  /v2/statistics/power-consumption?id&channel&date_range=custom&date_from&date_to&auth_key
 *     -> {timezone, interval: "hour"|"day", history:[{datetime, consumption (Wh), voltage, …}]}
 *     (one day -> hourly rows, a month -> daily rows; datetimes in `timezone`)
 *
 * Quirks handled here:
 *  - the ~1 req/s account limit is signalled as HTTP 401 with
 *    {"isok":false,"errors":{"max_req":"Request limit reached!"}} — not 429;
 *    we retry once after 1.5 s.
 *  - a rejected key is only "confirmed" when the body says `invalid_auth_key`.
 *  - the key travels in the query string, so URLs are never logged or put
 *    into error messages.
 */

export type ShellyErrorKind = 'config' | 'rate_limit' | 'auth' | 'http' | 'network' | 'bad_response';

export class ShellyError extends Error {
  constructor(
    readonly kind: ShellyErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ShellyError';
  }
}

/** One record of /v2/devices/api/get. */
export interface ShellyCloudDevice {
  id: string;
  type?: string;
  code?: string;
  gen?: string;
  online?: number | boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  status?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings?: Record<string, any>;
}

export interface ShellyDailyConsumption {
  /** Local calendar day (YYYY-MM-DD) in the account's timezone. */
  day: string;
  wh: number;
  voltageAvg: number | null;
}

const TIMEOUT_MS = 10_000;
const RATE_LIMIT_BACKOFF_MS = 1_500;
/** Spacing between consecutive calls in one invocation (shared 1 req/s budget). */
export const SHELLY_CALL_GAP_MS = 1_100;
const MAX_IDS_PER_CALL = 10;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `https://host` from SHELLY_SERVER_URI (accepts bare host, trailing slash, port/path). */
export function shellyBaseUrl(env: Env): string | null {
  let raw = (env.SHELLY_SERVER_URI ?? '').trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    return `https://${new URL(raw).hostname}`;
  } catch {
    return null;
  }
}

export function shellyConfigured(env: Env): boolean {
  return Boolean(shellyBaseUrl(env) && env.SHELLY_AUTH_KEY);
}

function isRateLimitBody(text: string): boolean {
  const t = text.toLowerCase();
  return t.includes('max_req') || t.includes('request limit');
}

/** Short, key-free excerpt of a response body for diagnostics. */
function excerpt(env: Env, text: string): string {
  let s = text.replace(/\s+/g, ' ').trim();
  if (env.SHELLY_AUTH_KEY) s = s.split(env.SHELLY_AUTH_KEY).join('<redacted>');
  return s.slice(0, 200);
}

async function shellyRequest(
  env: Env,
  path: string,
  init: { method: 'GET' | 'POST'; params?: Record<string, string>; json?: unknown },
): Promise<unknown> {
  const base = shellyBaseUrl(env);
  if (!base || !env.SHELLY_AUTH_KEY) {
    throw new ShellyError('config', 'SHELLY_SERVER_URI / SHELLY_AUTH_KEY not set');
  }
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(init.params ?? {})) url.searchParams.set(k, v);
  url.searchParams.set('auth_key', env.SHELLY_AUTH_KEY);

  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    let text: string;
    try {
      res = await fetch(url.toString(), {
        method: init.method,
        headers: init.json !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
        signal: ctrl.signal,
      });
      text = await res.text();
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new ShellyError('network', aborted ? `timeout on ${path}` : `network error on ${path}`);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429 || ((res.status === 401 || res.status === 403) && isRateLimitBody(text))) {
      if (attempt === 0) {
        await sleep(RATE_LIMIT_BACKOFF_MS);
        continue;
      }
      throw new ShellyError('rate_limit', 'Shelly Cloud rate limit (1 req/s)', res.status);
    }
    if (res.status === 401 || res.status === 403) {
      const confirmed = text.toLowerCase().includes('invalid_auth_key');
      throw new ShellyError(
        'auth',
        confirmed ? 'invalid_auth_key' : `refused (${res.status}): ${excerpt(env, text)}`,
        res.status,
      );
    }
    if (!res.ok) {
      throw new ShellyError('http', `HTTP ${res.status} on ${path}: ${excerpt(env, text)}`, res.status);
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ShellyError('bad_response', `non-JSON response on ${path}`);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = data as any;
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && obj.isok === false) {
      const errs = JSON.stringify(obj.errors ?? obj);
      if (isRateLimitBody(errs) && attempt === 0) {
        await sleep(RATE_LIMIT_BACKOFF_MS);
        continue;
      }
      if (errs.toLowerCase().includes('invalid_auth_key')) {
        throw new ShellyError('auth', 'invalid_auth_key', res.status);
      }
      throw new ShellyError('bad_response', `isok=false on ${path}: ${excerpt(env, errs)}`, res.status);
    }
    return data;
  }
  throw new ShellyError('rate_limit', 'Shelly Cloud rate limit (1 req/s)');
}

/**
 * Status (+ settings) of the given devices. Devices the cloud does not return
 * (e.g. unknown id, or long offline) are simply absent from the result.
 */
export async function getDevicesStatus(
  env: Env,
  ids: string[],
  select: Array<'status' | 'settings'> = ['status', 'settings'],
): Promise<ShellyCloudDevice[]> {
  const out: ShellyCloudDevice[] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_CALL) {
    if (i > 0) await sleep(SHELLY_CALL_GAP_MS);
    const data = await shellyRequest(env, '/v2/devices/api/get', {
      method: 'POST',
      json: { ids: ids.slice(i, i + MAX_IDS_PER_CALL), select },
    });
    if (!Array.isArray(data)) throw new ShellyError('bad_response', 'devices/api/get did not return an array');
    for (const rec of data) {
      if (rec && typeof rec === 'object' && typeof rec.id === 'string') out.push(rec as ShellyCloudDevice);
    }
  }
  return out;
}

/**
 * Daily consumption between two local days (inclusive), from the undocumented
 * statistics endpoint. Hourly rows (short ranges) are summed per day.
 */
export async function getDailyConsumption(
  env: Env,
  deviceId: string,
  channel: number,
  fromDay: string,
  toDay: string,
): Promise<ShellyDailyConsumption[]> {
  const data = (await shellyRequest(env, '/v2/statistics/power-consumption', {
    method: 'GET',
    params: {
      id: deviceId,
      channel: String(channel),
      date_range: 'custom',
      date_from: `${fromDay} 00:00:00`,
      date_to: `${toDay} 23:59:59`,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as any;
  const history: unknown[] = Array.isArray(data?.history) ? data.history : [];

  const byDay = new Map<string, { wh: number; vSum: number; vN: number }>();
  for (const row of history) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = row as any;
    const day = typeof r?.datetime === 'string' ? r.datetime.slice(0, 10) : null;
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const wh = Number(r.consumption);
    const v = Number(r.voltage);
    const acc = byDay.get(day) ?? { wh: 0, vSum: 0, vN: 0 };
    if (Number.isFinite(wh)) acc.wh += wh;
    if (Number.isFinite(v) && v > 0) {
      acc.vSum += v;
      acc.vN += 1;
    }
    byDay.set(day, acc);
  }
  return [...byDay.entries()].map(([day, a]) => ({
    day,
    wh: Math.round(a.wh * 100) / 100,
    voltageAvg: a.vN ? Math.round((a.vSum / a.vN) * 10) / 10 : null,
  }));
}
