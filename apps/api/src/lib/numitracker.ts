import type { GoldOffer } from '@life-os/shared-types';

/**
 * NumiTracker reader. The product list lives at the SSR HTML page below; the
 * data is embedded in Next.js RSC chunks (`self.__next_f.push([n,"..."])`).
 * We rebuild the payload string, locate the products infinite-query, and pull
 * out the `pages` array — the same approach the external gold-tracker uses.
 *
 * Read-only: we never POST or mutate anything on NumiTracker.
 */
const NUMI_BASE = 'https://numitracker.com/produkty/zloto';
const NUMI_PRODUCT = 'https://numitracker.com/produkt';

/** Build the canonical listing URL (PL offers, cheapest premium first). */
export function numiListingUrl(maxPrice: number): string {
  return `${NUMI_BASE}?max_price=${maxPrice}&order_by=over_spot_asc&offers_country=PL`;
}

/**
 * Walk a balanced `[...]` / `{...}` starting at `start` (which must point at the
 * opening bracket), respecting JSON string literals + escapes. Returns the
 * substring including both brackets, or null if unbalanced.
 */
function extractBalancedJson(str: string, start: number): string | null {
  const open = str[start];
  const close = open === '[' ? ']' : '}';
  if (open !== '[' && open !== '{') return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}

/** Rebuild the concatenated RSC payload from every `self.__next_f.push(...)`. */
function rebuildRscPayload(html: string): string {
  const marker = 'self.__next_f.push(';
  let combined = '';
  let idx = 0;
  while ((idx = html.indexOf(marker, idx)) !== -1) {
    const argStart = idx + marker.length;
    idx = argStart;
    const arrJson = extractBalancedJson(html, argStart);
    if (!arrJson) continue;
    try {
      const arr = JSON.parse(arrJson);
      if (Array.isArray(arr) && typeof arr[1] === 'string') combined += arr[1];
    } catch {
      /* malformed chunk — skip */
    }
  }
  return combined;
}

/** Loosely-typed product as it appears in the NumiTracker payload. */
interface RawProduct {
  id?: number;
  title?: string;
  slug?: string;
  price?: number;
  over_spot?: number;
  weight?: number;
  weight_g?: number;
  gold_weight?: number;
  gold_content?: number;
  buy_offers_data?: {
    best_offer?: { dealer?: { name?: string }; url?: string } | null;
  } | null;
}

/** Pull the product array out of a single `pages[]` entry, whatever its shape. */
function productsFromPage(page: unknown): RawProduct[] {
  if (Array.isArray(page)) return page as RawProduct[];
  if (page && typeof page === 'object') {
    const obj = page as Record<string, unknown>;
    for (const key of ['data', 'products', 'items', 'results']) {
      if (Array.isArray(obj[key])) return obj[key] as RawProduct[];
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v as RawProduct[];
    }
  }
  return [];
}

function rawWeight(p: RawProduct): number | null {
  const w = p.weight ?? p.weight_g ?? p.gold_weight ?? p.gold_content;
  return typeof w === 'number' && w > 0 ? w : null;
}

function toOffer(p: RawProduct): GoldOffer | null {
  if (typeof p.id !== 'number' || typeof p.price !== 'number' || typeof p.over_spot !== 'number') {
    return null;
  }
  const best = p.buy_offers_data?.best_offer ?? null;
  return {
    id: p.id,
    title: p.title ?? '—',
    slug: p.slug ?? '',
    price: p.price,
    overSpot: p.over_spot,
    weightGrams: rawWeight(p),
    dealer: best?.dealer?.name ?? null,
    dealerUrl: best?.url ?? null,
    numitrackerUrl: p.slug ? `${NUMI_PRODUCT}/${p.slug}` : NUMI_BASE,
  };
}

/**
 * Fetch + parse the NumiTracker gold listing, capped at `maxPrice` (PLN),
 * sorted by premium ascending. Returns [] on any fetch/parse failure.
 */
export async function fetchNumiOffers(maxPrice: number): Promise<GoldOffer[]> {
  let html: string;
  try {
    const res = await fetch(numiListingUrl(maxPrice), {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

  const payload = rebuildRscPayload(html);
  const markerIdx = payload.indexOf('"queryKey":["products","infinite"]');
  if (markerIdx === -1) return [];
  const pagesIdx = payload.indexOf('"pages":', markerIdx);
  if (pagesIdx === -1) return [];
  const arrStart = payload.indexOf('[', pagesIdx + '"pages":'.length);
  if (arrStart === -1) return [];
  const arrJson = extractBalancedJson(payload, arrStart);
  if (!arrJson) return [];

  let pages: unknown;
  try {
    pages = JSON.parse(arrJson);
  } catch {
    return [];
  }
  if (!Array.isArray(pages)) return [];

  const offers: GoldOffer[] = [];
  for (const page of pages) {
    for (const raw of productsFromPage(page)) {
      const offer = toOffer(raw);
      if (offer && offer.price <= maxPrice) offers.push(offer);
    }
  }

  const byId = new Map<number, GoldOffer>();
  for (const o of offers) if (!byId.has(o.id)) byId.set(o.id, o);
  return [...byId.values()].sort((a, b) => a.overSpot - b.overSpot);
}

/**
 * Opportunity thresholds, mirroring the gold-tracker `isOpportunity`:
 *   ≤ 600 zł  → premium ≤ 10.0%
 *   ≤ 1200 zł → premium ≤ 7.0%
 *   ≤ 2000 zł → premium ≤ 5.5%
 */
export const GOLD_TIERS: { maxPrice: number; threshold: number; label: string }[] = [
  { maxPrice: 600, threshold: 10.0, label: '≤ 600 zł (sztabki 1 g)' },
  { maxPrice: 1200, threshold: 7.0, label: '≤ 1200 zł (sztabki 2–2.5 g)' },
  { maxPrice: 2000, threshold: 5.5, label: '≤ 2000 zł (monety 1/10 oz, dukaty)' },
];

export function goldTier(price: number) {
  return GOLD_TIERS.find((t) => price <= t.maxPrice) ?? null;
}

export function isOpportunity(price: number, overSpot: number): boolean {
  const tier = goldTier(price);
  return tier !== null && overSpot <= tier.threshold;
}
