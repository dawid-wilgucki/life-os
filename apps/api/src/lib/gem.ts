// Port logiki gem-strategy-automation (Cloudflare Worker) do life-os —
// wersja on-demand. Źródło: gem-strategy-automation/src/index.js (runGemStrategy).
// Pominięto Telegram i KV: bieżącą pozycję portfela podaje wywołujący
// (currentHolding), a wynik zwracamy jako czysty JSON.

import type { GemMomentumEntry, GemRunResult } from '@life-os/shared-types';

// 6 śledzonych ETF. CBUO.L mapowany na stabilny odpowiednik IUS3.DE
// (iShares USD Treasury 1-3yr) — jak w oryginalnym workerze.
const TICKERS: Record<string, string> = {
  'EIMI.L': 'EIMI.L',
  'CNDX.L': 'CNDX.L',
  'IWDA.L': 'IWDA.L',
  'IUSQ.DE': 'IUSQ.DE',
  'CBUO.L': 'IUS3.DE',
  'IB01.L': 'IB01.L',
};

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { adjclose?: Array<{ adjclose?: number[] }> };
    }>;
  };
}

/**
 * Liczy momentum 12m-1m dla każdego ETF (okno: miesiąc -13 → miesiąc -2),
 * sortuje malejąco i wskazuje lidera. `rotate` jest prawdą, gdy lider różni się
 * od bieżącej pozycji `currentHolding`.
 */
export async function runGemMomentum(
  currentHolding: string | null = null,
): Promise<GemRunResult> {
  const now = new Date();
  const targetEnd = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const targetStart = new Date(now.getFullYear(), now.getMonth() - 13, 1);

  const ranking: GemMomentumEntry[] = [];
  let errorCount = 0;

  for (const [name, ticker] of Object.entries(TICKERS)) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1mo&range=2y`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });

      if (!response.ok) {
        console.log(`Yahoo Finance zwróciło status ${response.status} dla ${name}`);
        errorCount++;
        continue;
      }

      const data = (await response.json()) as YahooChartResponse;
      const timestamps = data.chart?.result?.[0]?.timestamp;
      const adjClose = data.chart?.result?.[0]?.indicators?.adjclose?.[0]?.adjclose;

      if (!timestamps || !adjClose) {
        errorCount++;
        continue;
      }

      let priceStart: number | null = null;
      let priceEnd: number | null = null;

      for (let i = 0; i < timestamps.length; i++) {
        const date = new Date(timestamps[i] * 1000);
        if (
          date.getFullYear() === targetStart.getFullYear() &&
          date.getMonth() === targetStart.getMonth()
        ) {
          priceStart = adjClose[i];
        }
        if (
          date.getFullYear() === targetEnd.getFullYear() &&
          date.getMonth() === targetEnd.getMonth()
        ) {
          priceEnd = adjClose[i];
        }
      }

      if (priceStart && priceEnd) {
        const momentum = ((priceEnd - priceStart) / priceStart) * 100;
        ranking.push({ name, momentum });
      } else {
        errorCount++;
      }
    } catch (e) {
      console.log(`Błąd pobierania danych dla ${name}: ${e}`);
      errorCount++;
    }
  }

  ranking.sort((a, b) => b.momentum - a.momentum);
  const leader = ranking.length > 0 ? ranking[0].name : null;

  return {
    ranking,
    leader,
    currentHolding,
    rotate: leader !== null && leader !== currentHolding,
    errorCount,
    ts: new Date().toISOString(),
  };
}
