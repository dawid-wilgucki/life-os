// Port logiki gold-tracker (Cloudflare Worker) do life-os — wersja on-demand.
// Źródło: gold-tracker/src/index.ts. Pominięto warstwę Telegrama i KV (dedup
// alertów potrzebny tylko w cronie). Tu liczy się czysty wynik `/check`.
//
// Niepewne elementy API NumiTrackera (jedno miejsce):
//   • produkt nie ma pola wagi — wagę parsujemy z `title` (parseWeightGrams).

import type { GoldCheckResult, GoldOffer } from '@life-os/shared-types';

interface NBPGoldEntry {
  data: string;
  cena: number;
}

interface BestOffer {
  dealer: { name: string };
  url: string;
}

interface BuyOffersData {
  best_offer: BestOffer | null;
}

interface NumiProduct {
  id: number;
  title: string;
  slug: string;
  price: number;
  over_spot: number;
  buy_offers_data: BuyOffersData | null;
}

interface NumiApiMeta {
  total_count: number;
  limit: number;
  offset: number;
  next_offset: number | null;
  has_more: boolean;
}

interface NumiApiResponse {
  status: string;
  data: NumiProduct[];
  meta: NumiApiMeta;
}

// ─── NBP ─────────────────────────────────────────────────────────────────────

async function fetchSpotPrice(): Promise<number | null> {
  try {
    const res = await fetch('https://api.nbp.pl/api/cenyzlota/?format=json', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      console.log(`NBP API error: ${res.status}`);
      return null;
    }
    const data = (await res.json()) as NBPGoldEntry[];
    if (!Array.isArray(data) || data.length === 0) return null;
    return data[0].cena;
  } catch (err) {
    console.log(`NBP fetch failed: ${err}`);
    return null;
  }
}

// ─── NumiTracker ──────────────────────────────────────────────────────────────

// Highest premium threshold of interest; results are sorted ascending by
// over_spot, so anything past this can be ignored.
const MAX_OVER_SPOT_PERCENT = 10.0;
const MAX_API_PAGES = 5;

async function fetchNumiProducts(maxPrice = 2000): Promise<NumiProduct[]> {
  const baseUrl =
    'https://numitracker.com/api/products' +
    `?metal_type=zloto&max_price=${maxPrice}&order_by=over_spot_asc&offers_country=PL&limit=100`;

  const headers = {
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    Referer: 'https://numitracker.com/produkty/zloto',
  };

  const products: NumiProduct[] = [];

  try {
    let offset = 0;

    for (let page = 0; page < MAX_API_PAGES; page++) {
      const res = await fetch(`${baseUrl}&offset=${offset}`, { headers });

      if (!res.ok) {
        console.log(`NumiTracker API error: ${res.status}`);
        break;
      }

      const body = (await res.json()) as NumiApiResponse;

      if (body.status !== 'success' || !Array.isArray(body.data)) {
        console.log(`NumiTracker API unexpected response: status=${body.status}`);
        break;
      }

      products.push(...body.data);

      const last = body.data[body.data.length - 1];
      if (
        !body.meta?.has_more ||
        body.meta.next_offset === null ||
        (last && last.over_spot > MAX_OVER_SPOT_PERCENT)
      ) {
        break;
      }
      offset = body.meta.next_offset;
    }

    console.log(`NumiTracker: found ${products.length} products`);
    return products;
  } catch (err) {
    console.log(`NumiTracker fetch/parse failed: ${err}`);
    return products;
  }
}

// ─── Waga z tytułu ─────────────────────────────────────────────────────────────

const OZ_TO_GRAMS = 31.1035;

/**
 * Wyciąga wagę produktu z tytułu w gramach.
 * Obsługuje: "1 g", "1g", "0,5 g", "1/2 oz", "1/12 oz", "1 oz", "1 uncja".
 * Uncje przeliczane × 31,1035. Przecinek dziesiętny traktowany jak kropka.
 * Brak dopasowania → null.
 */
function parseWeightGrams(title: string): number | null {
  const t = title.toLowerCase();

  // Ułamkowa uncja, np. "1/2 oz", "1/12 oz", "1/4 uncji"
  const fracOz = t.match(/(\d+)\s*\/\s*(\d+)\s*(?:oz|uncj\w*)/);
  if (fracOz) {
    const den = parseInt(fracOz[2], 10);
    if (den !== 0) return (parseInt(fracOz[1], 10) / den) * OZ_TO_GRAMS;
  }

  // Dziesiętna/całkowita uncja, np. "1 oz", "0,5 oz", "1 uncja"
  const oz = t.match(/(\d+(?:[.,]\d+)?)\s*(?:oz|uncj\w*)/);
  if (oz) return parseFloat(oz[1].replace(',', '.')) * OZ_TO_GRAMS;

  // Ułamkowy gram, np. "1/2 g"
  const fracG = t.match(/(\d+)\s*\/\s*(\d+)\s*g(?:ram\w*)?\b/);
  if (fracG) {
    const den = parseInt(fracG[2], 10);
    if (den !== 0) return parseInt(fracG[1], 10) / den;
  }

  // Dziesiętny/całkowity gram, np. "1 g", "1g", "0,5 g", "2,5g"
  const g = t.match(/(\d+(?:[.,]\d+)?)\s*g(?:ram\w*)?\b/);
  if (g) return parseFloat(g[1].replace(',', '.'));

  return null;
}

// ─── On-demand check (odpowiednik handleCheck bez Telegrama) ───────────────────

/**
 * Szuka ofert złota do `maxPrice` PLN, opcjonalnie filtrując po `maxPremium`
 * (premia nad SPOT w %). Zwraca pełną listę ofert posortowaną rosnąco po
 * over_spot oraz aktualny SPOT NBP.
 */
export async function checkGold(
  maxPrice: number,
  maxPremium: number | null,
): Promise<GoldCheckResult> {
  const [spot, products] = await Promise.all([fetchSpotPrice(), fetchNumiProducts(maxPrice)]);

  let offers: GoldOffer[] = products.map((p) => {
    const grams = parseWeightGrams(p.title);
    const premiumVsNbp =
      grams !== null && grams > 0 && spot !== null ? (p.price / grams / spot - 1) * 100 : null;
    return {
      title: p.title,
      price: p.price,
      grams,
      overSpot: p.over_spot,
      premiumVsNbpPct: premiumVsNbp !== null ? Number(premiumVsNbp.toFixed(2)) : null,
      dealer: p.buy_offers_data?.best_offer?.dealer?.name ?? null,
      numiUrl: `https://numitracker.com/produkt/${p.slug}`,
      dealerUrl: p.buy_offers_data?.best_offer?.url ?? null,
    };
  });

  if (maxPremium !== null) {
    offers = offers.filter((o) => o.overSpot <= maxPremium);
  }

  return {
    maxPrice,
    maxPremium,
    spotPlnPerGram: spot,
    count: offers.length,
    offers,
  };
}
