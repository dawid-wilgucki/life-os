import { Hono } from 'hono';
import type { GemStatus, GoldCheckResult, GoldOffersResult, GoldOpportunities, GoldStatus } from '@life-os/shared-types';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';
import { fetchNumiOffers, GOLD_TIERS, isOpportunity } from '../lib/numitracker';
import { sendTelegram } from '../lib/telegram';

const GEM_URL = 'https://gem-strategy.dawidwilgucki9.workers.dev/status';
const NBP_GOLD_URL = 'https://api.nbp.pl/api/cenyzlota/?format=json';

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

async function nbpSpotPerGram(): Promise<{ spot: number; asOf?: string } | null> {
  const raw = (await fetchJson(NBP_GOLD_URL)) as Array<{ data?: string; cena?: number }> | null;
  const entry = Array.isArray(raw) ? raw[raw.length - 1] : null;
  if (!entry || typeof entry.cena !== 'number') return null;
  return { spot: entry.cena, asOf: entry.data };
}

export const investmentsRouter = new Hono<AppContext>();
investmentsRouter.use('*', requireAuth);

// GET /api/investments/gold — live SPOT (PLN/g) from NBP. Read-only, no side effects.
investmentsRouter.get('/gold', async (c) => {
  const nbp = await nbpSpotPerGram();
  if (!nbp) return c.json({ error: 'NBP niedostępne' }, 503);
  return c.json({ spot: nbp.spot, currency: 'PLN', asOf: nbp.asOf, alerts: [] } satisfies GoldStatus);
});

// POST /api/investments/gold/check — premium calculator.
// Body: { price: number (PLN), weightGrams: number, spotPerGram?: number }
investmentsRouter.post('/gold/check', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    price?: number;
    weightGrams?: number;
    spotPerGram?: number;
  };
  const price = Number(body.price);
  const weightGrams = Number(body.weightGrams);
  if (!(price > 0) || !(weightGrams > 0))
    return c.json({ error: 'price and weightGrams must be positive numbers' }, 400);

  let spotPerGram = Number(body.spotPerGram);
  if (!(spotPerGram > 0)) {
    const nbp = await nbpSpotPerGram();
    if (!nbp) return c.json({ error: 'NBP niedostępne' }, 503);
    spotPerGram = nbp.spot;
  }

  const spotValue = weightGrams * spotPerGram;
  const overSpotPct = ((price - spotValue) / spotValue) * 100;
  const tier = GOLD_TIERS.find((t) => price <= t.maxPrice) ?? null;
  const threshold = tier?.threshold ?? null;

  return c.json({
    price,
    weightGrams,
    spotPerGram,
    spotValue,
    overSpotPct,
    threshold,
    isOpportunity: threshold !== null && overSpotPct <= threshold,
    tier: tier?.label ?? '> 2000 zł (poza zakresem trackera)',
  } satisfies GoldCheckResult);
});

// POST /api/investments/gold/offers — fetch NumiTracker offers, send Telegram summary.
// Body: { maxPrice?: number }  (default 2000, capped at 10000)
investmentsRouter.post('/gold/offers', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { maxPrice?: number };
  const maxPrice = Math.min(Math.max(Number(body.maxPrice) || 2000, 100), 10000);

  const [offers, nbp] = await Promise.all([fetchNumiOffers(maxPrice), nbpSpotPerGram()]);
  const opps = offers.filter((o) => isOpportunity(o.price, o.overSpot));
  const spotStr = nbp ? `${nbp.spot.toFixed(2)} PLN/g` : 'brak danych';

  const rows = opps.slice(0, 12).map((o) => {
    const g = o.weightGrams != null ? `${o.weightGrams}g` : '—';
    const cena = `${Math.round(o.price)} zł`;
    const prem = `${o.overSpot.toFixed(1)}%`;
    const dealer = (o.dealer ?? '—').slice(0, 12);
    return `${g.padEnd(6)}| ${cena.padEnd(8)}| ${prem.padEnd(6)}| ${dealer}`;
  });
  const tableBody = opps.length
    ? `🏆 ${opps.length} okazji ≤ ${maxPrice} zł\n\n<code>gram  | cena    | prem  | dealer\n${rows.join('\n')}</code>`
    : `✅ Brak okazji przy ≤ ${maxPrice} zł.`;
  const msg = `📊 Sprawdzono oferty (≤ ${maxPrice} zł)\n🔍 Ofert: <b>${offers.length}</b> | SPOT: ${spotStr}\n\n${tableBody}`;
  sendTelegram(c.env, msg);

  return c.json({
    maxPrice,
    spotPerGram: nbp?.spot ?? null,
    asOf: nbp?.asOf,
    count: offers.length,
    offers,
  } satisfies GoldOffersResult);
});

// GET /api/investments/gold/opportunities — daily snapshot from KV (populated by cron).
investmentsRouter.get('/gold/opportunities', async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const raw = await c.env.TOKENS.get(`gold_opportunities:${today}`);
  if (!raw) {
    return c.json({ date: null, spotPerGram: null, count: 0, offers: [] } satisfies GoldOpportunities);
  }
  return c.json(JSON.parse(raw) as GoldOpportunities);
});

// GET /api/investments/gem — proxy to gem-strategy /status.
investmentsRouter.get('/gem', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await fetchJson(GEM_URL)) as any;
  if (!raw || !Array.isArray(raw.ranking)) {
    return c.json({ ranking: [], currentHolding: null } satisfies GemStatus);
  }
  return c.json({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ranking: raw.ranking.map((r: any) => ({
      ticker: r.ticker ?? r.symbol ?? '?',
      score: Number(r.score ?? r.momentum ?? 0),
    })),
    currentHolding: raw.currentHolding ?? raw.holding ?? null,
  } satisfies GemStatus);
});
