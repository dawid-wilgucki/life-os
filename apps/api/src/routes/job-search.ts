import { Hono } from 'hono';
import type { JobOffer } from '@life-os/shared-types';
import type { AppContext, Env } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';

export const jobSearchRouter = new Hono<AppContext>();
jobSearchRouter.use('*', requireAuth);

// ── helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toOffer(row: any): JobOffer {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    salary_from: row.salary_from ?? null,
    salary_to: row.salary_to ?? null,
    currency: row.currency ?? null,
    url: row.url,
    source: row.source,
    location: row.location ?? null,
    remote: row.remote,
    created_at: row.created_at,
    dismissed: row.dismissed,
  };
}

interface OfferInput {
  title: string;
  company: string;
  salary_from: number | null;
  salary_to: number | null;
  currency: string | null;
  url: string;
  source: 'justjoin' | 'nofluffjobs';
  location: string | null;
  remote: boolean;
}

// Browser-like headers to avoid bot detection on CF Worker IPs
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  Referer: 'https://justjoin.it/',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
};

async function scrapeJustJoinIT(): Promise<OfferInput[]> {
  const res = await fetch('https://justjoin.it/api/offers', {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`non-JSON response (${contentType.split(';')[0]})`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await res.json();
  // Handle both flat array and wrapped formats: { data:[...] } | { offers:[...] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = Array.isArray(raw) ? raw : (raw?.data ?? raw?.offers ?? raw?.postings ?? []);

  if (all.length === 0) throw new Error(`empty response (keys: ${Object.keys(raw ?? {}).join(', ')})`);

  const results: OfferInput[] = [];

  for (const o of all) {
    // Tech filter: Angular
    const icon = (o.marker_icon ?? '').toLowerCase();
    const skills: string[] = (o.skills ?? []).map((s: { name: string }) => s.name.toLowerCase());
    const titleLow = (o.title ?? '').toLowerCase();
    const isAngular =
      icon === 'angular' || skills.includes('angular') || titleLow.includes('angular');
    if (!isAngular) continue;

    // Seniority filter: junior or mid only
    const lvl = (o.experience_level ?? '').toLowerCase();
    if (lvl && lvl !== 'junior' && lvl !== 'mid') continue;

    // Location filter: Kraków or remote/hybrid
    const city = (o.city ?? '').toLowerCase().replace(/ó/g, 'o');
    const wt = (o.workplace_type ?? '').toLowerCase();
    const isRemote =
      o.remote === true || wt === 'remote' || wt === 'hybrid' || wt === 'partly_remote';
    const isKrakow = city === 'krakow' || city.startsWith('krak');
    if (!isRemote && !isKrakow) continue;

    // Salary: pick first employment type that has a salary defined
    const empTypes: Array<{ salary?: { from: number; to: number; currency: string } | null }> =
      o.employment_types ?? [];
    const salary = empTypes.find((e) => e.salary)?.salary ?? null;

    results.push({
      title: o.title ?? 'Unknown',
      company: o.company_name ?? 'Unknown',
      salary_from: salary ? Math.round(salary.from) : null,
      salary_to: salary ? Math.round(salary.to) : null,
      currency: salary?.currency ?? null,
      url: `https://justjoin.it/offers/${o.id}`,
      source: 'justjoin',
      location: o.city ?? null,
      remote: isRemote,
    });
  }

  return results;
}

async function scrapeNoFluffJobs(): Promise<OfferInput[]> {
  const results: OfferInput[] = [];

  const searches = [
    'criteria=requirement%3Dangular+city%3Dkrakow',
    'criteria=requirement%3Dangular&remote=true',
  ];

  for (const qs of searches) {
    const res = await fetch(
      `https://nofluffjobs.com/api/search/posting?${qs}&salaryCurrency=PLN&salaryPeriod=month`,
      {
        headers: { ...BROWSER_HEADERS, Referer: 'https://nofluffjobs.com/' },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) continue;

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const postings: any[] = data.postings ?? data.items ?? [];

    for (const o of postings) {
      const seniority: string[] = (o.seniority ?? []).map((s: string) => s.toLowerCase());
      const isJuniorMid =
        seniority.length === 0 || seniority.some((s) => s === 'junior' || s === 'mid');
      if (!isJuniorMid) continue;

      const fullyRemote = o.location?.fullyRemote === true || o.remote === true;
      const city: string | null = o.location?.places?.[0]?.city ?? null;

      results.push({
        title: o.name ?? o.title ?? 'Unknown',
        company: o.company?.name ?? 'Unknown',
        salary_from: o.salary?.from ?? null,
        salary_to: o.salary?.to ?? null,
        currency: o.salary?.currency ?? null,
        url: o.url ?? `https://nofluffjobs.com/pl/job/${o.id}`,
        source: 'nofluffjobs',
        location: city,
        remote: fullyRemote,
      });
    }
  }

  return results;
}

export interface FetchSummary {
  fetched: number;
  saved: number;
  sources: {
    justjoin: string;   // e.g. "12 offers" or "error: HTTP 403 Forbidden"
    nofluffjobs: string;
  };
}

export async function fetchAndSaveJobOffers(env: Env): Promise<FetchSummary> {
  const collected: OfferInput[] = [];
  const sources = { justjoin: '', nofluffjobs: '' };

  try {
    const jji = await scrapeJustJoinIT();
    collected.push(...jji);
    sources.justjoin = `${jji.length} ofert`;
    console.log(`[job-search] JustJoin.IT: ${jji.length} matched`);
  } catch (e) {
    sources.justjoin = `błąd: ${String(e).replace('Error: ', '')}`;
    console.error('[job-search] JustJoin.IT failed:', String(e));
  }

  try {
    const nfj = await scrapeNoFluffJobs();
    collected.push(...nfj);
    sources.nofluffjobs = `${nfj.length} ofert`;
    console.log(`[job-search] NoFluffJobs: ${nfj.length} matched`);
  } catch (e) {
    sources.nofluffjobs = `błąd: ${String(e).replace('Error: ', '')}`;
    console.error('[job-search] NoFluffJobs failed:', String(e));
  }

  if (collected.length === 0) return { fetched: 0, saved: 0, sources };

  const supabase = createSupabase(env);
  const { error } = await supabase
    .from('job_offers')
    .upsert(collected, { onConflict: 'url', ignoreDuplicates: true });

  if (error) {
    console.error('[job-search] upsert failed:', error.message);
    return { fetched: collected.length, saved: 0, sources };
  }

  return { fetched: collected.length, saved: collected.length, sources };
}

// ── routes ───────────────────────────────────────────────────────────────────

// GET /api/job-search/offers
jobSearchRouter.get('/offers', async (c) => {
  const supabase = createSupabase(c.env);
  const { data, error } = await supabase
    .from('job_offers')
    .select('*')
    .eq('dismissed', false)
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json((data ?? []).map(toOffer));
});

// POST /api/job-search/fetch — manual trigger + cron
jobSearchRouter.post('/fetch', async (c) => {
  const result = await fetchAndSaveJobOffers(c.env);
  return c.json(result);
});

// PATCH /api/job-search/offers/:id/dismiss
jobSearchRouter.patch('/offers/:id/dismiss', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabase(c.env);
  const { error } = await supabase.from('job_offers').update({ dismissed: true }).eq('id', id);
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.body(null, 204);
});
