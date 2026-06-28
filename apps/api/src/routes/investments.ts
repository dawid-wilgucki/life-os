import { Hono } from 'hono';
import type {
  GemRunResult,
  GemStatus,
  GoldCheckResult,
  GoldStatus,
} from '@life-os/shared-types';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';
import { checkGold } from '../lib/gold';
import { runGemMomentum } from '../lib/gem';

// External, read-only Workers. Life.OS NEVER modifies these.
const GOLD_URL = 'https://gold-tracker.dawidwilgucki9.workers.dev/';
const GEM_URL = 'https://gem-strategy.dawidwilgucki9.workers.dev/status';

export const investmentsRouter = new Hono<AppContext>();
investmentsRouter.use('*', requireAuth);

async function fetchJson(url: string, timeoutMs = 5000): Promise<unknown | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const GOLD_MOCK: GoldStatus = {
  spot: 9875.4,
  currency: 'PLN',
  alerts: [{ message: 'Mock alert: SPOT crossed 9800 PLN/oz', at: new Date().toISOString() }],
  mock: true,
};

const GEM_MOCK: GemStatus = {
  ranking: [
    { ticker: 'SPY', score: 0.82 },
    { ticker: 'QQQ', score: 0.78 },
    { ticker: 'EEM', score: 0.69 },
  ],
  currentHolding: 'SPY',
  mock: true,
};

// GET /api/investments/gold — proxy to gold-tracker (mock if unavailable).
investmentsRouter.get('/gold', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await fetchJson(GOLD_URL)) as any;
  // TODO: confirm the real gold-tracker response shape and map precisely.
  const spot = raw?.spot ?? raw?.price ?? raw?.spotPrice;
  if (typeof spot !== 'number') return c.json(GOLD_MOCK);

  const status: GoldStatus = {
    spot,
    currency: raw.currency ?? 'PLN',
    alerts: Array.isArray(raw.alerts)
      ? raw.alerts.map((a: unknown) =>
          typeof a === 'string'
            ? { message: a, at: new Date().toISOString() }
            : { message: (a as any)?.message ?? String(a), at: (a as any)?.at ?? new Date().toISOString() },
        )
      : [],
  };
  return c.json(status);
});

// GET /api/investments/gem — proxy to gem-strategy /status (mock if unavailable).
investmentsRouter.get('/gem', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await fetchJson(GEM_URL)) as any;
  // TODO: confirm the real gem-strategy /status shape and map precisely.
  if (!raw || !Array.isArray(raw.ranking)) return c.json(GEM_MOCK);

  const status: GemStatus = {
    ranking: raw.ranking.map((r: any) => ({
      ticker: r.ticker ?? r.symbol ?? '?',
      score: Number(r.score ?? r.momentum ?? 0),
    })),
    currentHolding: raw.currentHolding ?? raw.holding ?? null,
  };
  return c.json(status);
});

// POST /api/investments/gold/check — on-demand check (port of gold-tracker /check).
// Body: { maxPrice: number, maxPremium?: number | null }
investmentsRouter.post('/gold/check', async (c) => {
  const body = await c.req
    .json<{ maxPrice?: number; maxPremium?: number | null }>()
    .catch(() => ({}) as { maxPrice?: number; maxPremium?: number | null });

  const maxPrice = Number(body.maxPrice);
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
    return c.json({ error: 'invalid_amount' }, 400);
  }

  const maxPremium =
    body.maxPremium != null && Number.isFinite(Number(body.maxPremium))
      ? Number(body.maxPremium)
      : null;

  const result: GoldCheckResult = await checkGold(maxPrice, maxPremium);
  return c.json(result);
});

// POST /api/investments/gem/run — on-demand momentum analysis (port of /sprawdz).
// Body: { currentHolding?: string }
investmentsRouter.post('/gem/run', async (c) => {
  const body = await c.req
    .json<{ currentHolding?: string }>()
    .catch(() => ({}) as { currentHolding?: string });

  const result: GemRunResult = await runGemMomentum(body.currentHolding ?? null);
  return c.json(result);
});
