import { Hono } from 'hono';
import type { SolarCurrentData, SolarStatus, SolarTokenRefreshResult } from '@life-os/shared-types';
import type { AppContext, Env } from '../types';
import { requireAuth } from '../middleware/auth';

const TOKEN_URL = 'https://globalapi.solarmanpv.com/account/v1.0/token';
const CURRENT_URL = 'https://globalapi.solarmanpv.com/device/v1.0/currentData';
// Inverter SN (not the COLLECTOR) — currentData is reported per inverter.
const INVERTER_SN = 'T620400072248491';
const TOKEN_KV_KEY = 'solarman_token';
// Fallback TTL if Solarman omits expires_in (~60d token, keep a safety margin).
const DEFAULT_TTL = 55 * 24 * 3600;
// Drop the cached token this long before its real expiry.
const TTL_MARGIN = 3600;

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

/** Mint a fresh token from Solarman and cache it in KV. Returns expiresIn (s) or null. */
async function mintToken(env: Env): Promise<number | null> {
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
  if (!token || data?.success === false) return null;

  // expires_in comes back as a string, e.g. "5183999".
  const expiresIn = Number(data?.expires_in);
  const ttl = Number.isFinite(expiresIn) && expiresIn > TTL_MARGIN ? expiresIn - TTL_MARGIN : DEFAULT_TTL;

  await env.TOKENS.put(TOKEN_KV_KEY, token, { expirationTtl: ttl });
  return Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : ttl;
}

/** Cached token from KV, or mint a new one (unless forceRefresh). */
async function getToken(env: Env, forceRefresh = false): Promise<string | null> {
  if (!forceRefresh) {
    const cached = await env.TOKENS.get(TOKEN_KV_KEY);
    if (cached) return cached;
  }
  const ok = await mintToken(env);
  if (ok === null) return null;
  return env.TOKENS.get(TOKEN_KV_KEY);
}

function mapStatus(invStatus: string | undefined, deviceState: unknown): SolarStatus {
  if (invStatus === 'Grid') return 'online';
  if (deviceState === 1) return 'online';
  if (deviceState === 2) return 'alarm';
  if (deviceState === 3) return 'offline';
  return 'unknown';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCurrent(data: any): SolarCurrentData {
  const list: any[] = Array.isArray(data?.dataList) ? data.dataList : [];
  // Raw string values keyed by Solarman data key.
  const byKey: Record<string, string> = {};
  for (const it of list) {
    if (it?.key != null) byKey[it.key] = String(it.value ?? '');
  }
  const num = (key: string): number => {
    const v = Number(byKey[key]);
    return Number.isFinite(v) ? v : 0;
  };

  const collectionTime = Number(data?.collectionTime);
  const validTime = Number.isFinite(collectionTime) && collectionTime > 0;

  return {
    powerNow: num('APo_t1'),
    energyToday: num('Etdy_ge1'),
    energyTotal: num('Et_ge0'),
    status: mapStatus(byKey['INV_ST1'], data?.deviceState),
    temperature: num('T_RDT1'),
    pvVoltage: num('DV1'),
    pvCurrent: num('DC1'),
    pvPower: num('DP1'),
    collectionTime: validTime ? collectionTime : 0,
    updatedAt: validTime ? new Date(collectionTime * 1000).toISOString() : new Date().toISOString(),
  };
}

/** POST currentData with a token. Returns parsed body, or null on failure. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchCurrent(token: string): Promise<any | null> {
  const res = await fetchWithTimeout(CURRENT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ deviceSn: INVERTER_SN }),
  });
  if (!res) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  // Solarman returns HTTP 200 with success:false on an expired/invalid token.
  if (data?.success === false && !Array.isArray(data?.dataList)) return null;
  return data;
}

// GET /api/solar/token/refresh — force a new token, store it in KV (token never leaves the server).
solarRouter.get('/token/refresh', async (c) => {
  const expiresIn = await mintToken(c.env);
  if (expiresIn === null) {
    return c.json({ success: false, expiresIn: 0 } satisfies SolarTokenRefreshResult, 503);
  }
  return c.json({ success: true, expiresIn } satisfies SolarTokenRefreshResult);
});

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
