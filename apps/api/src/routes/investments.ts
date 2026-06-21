import { Hono } from 'hono';
import type { GemStatus, GoldCheckResult, GoldRunResult, GoldStatus } from '@life-os/shared-types';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';

// External, read-only Workers. Life.OS NEVER modifies these.
const GOLD_URL = 'https://gold-tracker.dawidwilgucki9.workers.dev/';
const GEM_URL = 'https://gem-strategy.dawidwilgucki9.workers.dev/status';

// NBP cenyzlota — same SPOT source the gold-tracker uses, but read-only with no
// side effects. Returns [{ data: "2026-06-10", cena: 510.02 }] = PLN per gram .999.
const NBP_GOLD_URL = 'https://api.nbp.pl/api/cenyzlota/?format=json';

// Opportunity thresholds, copied verbatim from the gold-tracker `isOpportunity`.
const GOLD_TIERS: { maxPrice: number; threshold: number; label: string }[] = [
  { maxPrice: 600, threshold: 10.0, label: '≤ 600 zł (sztabki 1 g)' },
  { maxPrice: 1200, threshold: 7.0, label: '≤ 1200 zł (sztabki 2–2.5 g)' },
  { maxPrice: 2000, threshold: 5.5, label: '≤ 2000 zł (monety 1/10 oz, dukaty)' },
];

async function nbpSpotPerGram(): Promise<{ spot: number; asOf?: string } | null> {
  const raw = (await fetchJson(NBP_GOLD_URL)) as Array<{ data?: string; cena?: number }> | null;
  const entry = Array.isArray(raw) ? raw[raw.length - 1] : null;
  if (!entry || typeof entry.cena !== 'number') return null;
  return { spot: entry.cena, asOf: entry.data };
}

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

// PLN per gram, matching the NBP unit (not per oz).
const GOLD_MOCK: GoldStatus = {
  spot: 510.02,
  currency: 'PLN',
  asOf: new Date().toISOString().slice(0, 10),
  alerts: [],
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

// GET /api/investments/gold — live SPOT (PLN/g) from NBP. Read-only, no side
// effects, so it is safe to call on every page load / refresh. (Calling the
// gold-tracker worker here would fire Telegram alerts + KV writes each time.)
investmentsRouter.get('/gold', async (c) => {
  const nbp = await nbpSpotPerGram();
  if (!nbp) return c.json(GOLD_MOCK);

  const status: GoldStatus = {
    spot: nbp.spot,
    currency: 'PLN',
    asOf: nbp.asOf,
    alerts: [],
  };
  return c.json(status);
});

// POST /api/investments/gold/check — premium calculator. Computes the premium of
// an offer over live SPOT and verdicts it against the gold-tracker thresholds.
// Body: { price: number (PLN), weightGrams: number, spotPerGram?: number }
investmentsRouter.post('/gold/check', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    price?: number;
    weightGrams?: number;
    spotPerGram?: number;
  };
  const price = Number(body.price);
  const weightGrams = Number(body.weightGrams);
  if (!(price > 0) || !(weightGrams > 0)) {
    return c.json({ error: 'price and weightGrams must be positive numbers' }, 400);
  }

  let spotPerGram = Number(body.spotPerGram);
  let mock = false;
  if (!(spotPerGram > 0)) {
    const nbp = await nbpSpotPerGram();
    if (nbp) spotPerGram = nbp.spot;
    else {
      spotPerGram = GOLD_MOCK.spot;
      mock = true;
    }
  }

  const spotValue = weightGrams * spotPerGram;
  const overSpotPct = ((price - spotValue) / spotValue) * 100;
  const tier = GOLD_TIERS.find((t) => price <= t.maxPrice) ?? null;
  const threshold = tier?.threshold ?? null;
  const isOpportunity = threshold !== null && overSpotPct <= threshold;

  const result: GoldCheckResult = {
    price,
    weightGrams,
    spotPerGram,
    spotValue,
    overSpotPct,
    threshold,
    isOpportunity,
    tier: tier?.label ?? '> 2000 zł (poza zakresem trackera)',
    ...(mock ? { mock: true } : {}),
  };
  return c.json(result);
});

// POST /api/investments/gold/run — manual trigger of the gold-tracker check.
// Hits the worker's GET / which scrapes NumiTracker and pushes Telegram alerts,
// then returns its counters. Side-effecting on purpose ("Sprawdź teraz").
investmentsRouter.post('/gold/run', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await fetchJson(GOLD_URL, 15000)) as any;
  if (!raw || typeof raw.checked !== 'number') {
    return c.json({ checked: 0, alertsSent: 0, spotPerGram: null, mock: true } satisfies GoldRunResult);
  }
  return c.json({
    checked: raw.checked,
    alertsSent: typeof raw.alerts_sent === 'number' ? raw.alerts_sent : 0,
    spotPerGram: typeof raw.spot_pln_per_gram === 'number' ? raw.spot_pln_per_gram : null,
  } satisfies GoldRunResult);
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
