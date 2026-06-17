import { Hono } from 'hono';
import type { SolarData } from '@life-os/shared-types';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';

const TOKEN_URL = 'https://globalapi.solarmanpv.com/account/v1.0/token';
const CURRENT_URL = 'https://globalapi.solarmanpv.com/device/v1.0/currentData';
const DEVICE_SN = '3504457773';
const TOKEN_KV_KEY = 'solarman_token';
const TOKEN_TTL = 55 * 24 * 3600; // 55 days — Solarman tokens last ~60d.

export const solarRouter = new Hono<AppContext>();
solarRouter.use('*', requireAuth);

/** fetch() with an abort timeout. Returns null on any network/HTTP failure. */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 8000): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Get a Solarman access token from KV cache, or mint+cache a fresh one. */
async function getToken(env: AppContext['Bindings'], forceRefresh = false): Promise<string | null> {
  if (!forceRefresh) {
    const cached = await env.TOKENS.get(TOKEN_KV_KEY);
    if (cached) return cached;
  }

  const url = `${TOKEN_URL}?appId=${encodeURIComponent(env.SOLARMAN_APP_ID)}&language=en`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      appSecret: env.SOLARMAN_APP_SECRET,
      email: env.SOLARMAN_EMAIL,
      password: env.SOLARMAN_PASSWORD_SHA256,
    }),
  });
  if (!res) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  const token: string | undefined = data?.access_token;
  if (!token) return null;

  await env.TOKENS.put(TOKEN_KV_KEY, token, { expirationTtl: TOKEN_TTL });
  return token;
}

/** Pick the first present, numeric value from a list of candidate keys. */
function pick(map: Record<string, number>, keys: string[]): number {
  for (const k of keys) {
    if (map[k] != null && !Number.isNaN(map[k])) return map[k];
  }
  return 0;
}

// Device-specific dataList keys vary by inverter. These candidate lists are
// best-effort; confirm against the real currentData response and trim as needed.
const POWER_KEYS = ['INV_O_P_T', 'APo_t1', 'P_AC', 'AC_POWER', 'SYSTEM_POWER', 'GENERATION_POWER', 'generation_power', 'DC_PW_T'];
const TODAY_KEYS = ['Etdy_ge0', 'Etdy_ge1', 'DAILY_GENERATION', 'GENERATION_TODAY', 'generation_today', 'daily_generation'];
const TOTAL_KEYS = ['Et_ge0', 'Et_ge1', 'CUM_GENERATION', 'TOTAL_GENERATION', 'generation_total', 'total_generation'];

function deviceStatus(state: unknown): SolarData['status'] {
  // Solarman deviceState: 1 = online, 2 = alarm/fault, 3 = offline.
  if (state === 1) return 'online';
  if (state === 2) return 'alarm';
  return 'offline';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCurrent(data: any): SolarData {
  const list: any[] = Array.isArray(data?.dataList) ? data.dataList : [];
  const map: Record<string, number> = {};
  for (const it of list) {
    const v = Number(it?.value);
    if (it?.key && !Number.isNaN(v)) map[it.key] = v;
  }
  const collection = Number(data?.collectionTime);
  return {
    powerNow: pick(map, POWER_KEYS),
    energyToday: pick(map, TODAY_KEYS),
    energyTotal: pick(map, TOTAL_KEYS),
    status: deviceStatus(data?.deviceState),
    updatedAt: Number.isFinite(collection) && collection > 0
      ? new Date(collection * 1000).toISOString()
      : new Date().toISOString(),
  };
}

/** POST currentData with a token. Returns parsed body, or null on failure. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchCurrent(token: string): Promise<any | null> {
  const res = await fetchWithTimeout(CURRENT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ deviceSn: DEVICE_SN }),
  });
  if (!res) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  // Solarman often returns HTTP 200 with success:false on an expired token.
  if (data?.success === false && !Array.isArray(data?.dataList)) return null;
  return data;
}

// GET /api/solar/current — live PV data from Solarman (KV-cached token).
solarRouter.get('/current', async (c) => {
  let token = await getToken(c.env);
  if (!token) return c.json({ error: 'solarman_unavailable' }, 503);

  let data = await fetchCurrent(token);
  if (!data) {
    // Token may be stale — drop it and retry once with a fresh one.
    await c.env.TOKENS.delete(TOKEN_KV_KEY);
    token = await getToken(c.env, true);
    if (!token) return c.json({ error: 'solarman_unavailable' }, 503);
    data = await fetchCurrent(token);
  }
  if (!data) return c.json({ error: 'solarman_unavailable' }, 503);

  return c.json(parseCurrent(data));
});
