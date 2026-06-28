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

const GEM_URL = 'https://gem-strategy.dawidwilgucki9.workers.dev/status';

const OZ_TO_GRAMS = 31.1035;

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

// GET /api/investments/gold — real-time price from NBP (PLN/g and PLN/oz).
investmentsRouter.get('/gold', async (c) => {
  const raw = (await fetchJson('https://api.nbp.pl/api/cenyzlota/?format=json')) as
    | { data: string; cena: number }[]
    | null;
  if (!Array.isArray(raw) || raw.length === 0) {
    return c.json({ error: 'nbp_unavailable' }, 503);
  }
  const pricePerGram = raw[0].cena;
  const status: GoldStatus = {
    pricePerGram,
    pricePerOz: Number((pricePerGram * OZ_TO_GRAMS).toFixed(2)),
    date: raw[0].data,
  };
  return c.json(status);
});

// GET /api/investments/gem — proxy to gem-strategy /status (mock if unavailable).
investmentsRouter.get('/gem', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await fetchJson(GEM_URL)) as any;
  const GEM_MOCK: GemStatus = {
    ranking: [
      { ticker: 'SPY', score: 0.82 },
      { ticker: 'QQQ', score: 0.78 },
      { ticker: 'EEM', score: 0.69 },
    ],
    currentHolding: 'SPY',
    mock: true,
  };
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
