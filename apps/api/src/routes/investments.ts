import { Hono } from 'hono';
import type {
  GemRunResult,
  GemStatus,
  GoldAnalysisResult,
  GoldCheckResult,
  GoldOffer,
  GoldStatus,
} from '@life-os/shared-types';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';
import { checkGold } from '../lib/gold';
import { runGemMomentum } from '../lib/gem';
import { geminiGenerate } from '../lib/gemini';

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

// POST /api/investments/gold/analyze — Gemini analysis of NumiTracker offers.
// Body: { offers: GoldOffer[], spotPlnPerGram: number | null }
investmentsRouter.post('/gold/analyze', async (c) => {
  if (!c.env.GEMINI_API_KEY) return c.json({ error: 'gemini_not_configured' }, 503);

  const body = await c.req
    .json<{ offers?: GoldOffer[]; spotPlnPerGram?: number | null }>()
    .catch(() => ({}) as { offers?: GoldOffer[]; spotPlnPerGram?: number | null });

  const offers = body.offers;
  if (!Array.isArray(offers) || offers.length === 0) {
    return c.json({ error: 'no_offers' }, 400);
  }

  const spot = body.spotPlnPerGram ?? null;
  const spotLine =
    spot != null
      ? `Kurs NBP: ${spot.toFixed(2)} zł/g | ${(spot * OZ_TO_GRAMS).toFixed(2)} zł/oz`
      : 'Kurs NBP: niedostępny';

  const offerLines = offers
    .slice(0, 50)
    .map(
      (o, i) =>
        `${i + 1}. ${o.title} | ${o.grams != null ? o.grams.toFixed(3) + ' g' : '? g'} | ${o.price.toFixed(2)} zł | premia: +${o.overSpot.toFixed(2)}% | ${o.dealer ?? '—'}`,
    )
    .join('\n');

  const prompt = `Jesteś ekspertem od inwestowania w złoto fizyczne na polskim rynku. Analizujesz dane z NumiTracker.

${spotLine}
Liczba ofert w zestawieniu: ${offers.length}

OFERTY (posortowane rosnąco po premii nad spot):
${offerLines}

Przygotuj szczegółową analizę w czterech sekcjach. Pisz po polsku, konkretnie i rzeczowo. NIE używaj formatowania markdown (bez gwiazdek, bez hashtagów) — używaj wyłącznie nagłówków WIELKIMI LITERAMI i myślników dla list.

OCENA RYNKU
Oceń ogólny poziom premii (niskie / typowe / wysokie w stosunku do normy 3-8%). Jak wygląda podaż — dużo ofert czy mało? Czy coś rzuca się w oczy?

TOP OKAZJE
Wskaż 3-5 konkretnych ofert które uważasz za najlepsze. Dla każdej podaj: nazwę, wagę, cenę, premię i dlaczego ją polecasz. Uwzględnij stosunek ceny do wagi.

MONETY VS SZTABKI
Porównaj dostępne monety bulionowe i sztabki. Która kategoria ma teraz niższe premie? Jakie są różnice w płynności i rozpoznawalności?

REKOMENDACJA
Czy warto kupować teraz, czy lepiej poczekać? Podaj konkretne sugestie dla różnych budżetów (np. do 1000 zł, do 3000 zł, powyżej 5000 zł). Na co zwrócić szczególną uwagę przy zakupie?`;

  const res = await geminiGenerate(c.env, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2000 },
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('Gemini gold analyze error:', res.status, detail);
    return c.json({ error: 'gemini_error', detail }, 502);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const analysis: string = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text ?? '';

  const result: GoldAnalysisResult = { analysis };
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
