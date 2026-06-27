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
  source: 'justjoin' | 'nofluffjobs' | 'remotive';
  location: string | null;
  remote: boolean;
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
};

// ── scrapers ─────────────────────────────────────────────────────────────────

async function scrapeJustJoinIT(): Promise<OfferInput[]> {
  // JJI removed their public API. Attempt the v2 subdomain endpoint as best effort.
  const res = await fetch(
    'https://api.justjoin.it/v2/user-panel/offers?perPage=100&page=1&keyword=angular',
    { headers: { ...BROWSER_HEADERS, Referer: 'https://justjoin.it/' }, signal: AbortSignal.timeout(20_000) },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`non-JSON (${contentType.split(';')[0]})`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = Array.isArray(raw) ? raw : (raw?.data ?? raw?.offers ?? raw?.postings ?? []);

  const results: OfferInput[] = [];
  for (const o of all) {
    const lvl = (o.experience_level ?? o.experienceLevel ?? '').toLowerCase();
    if (lvl && lvl !== 'junior' && lvl !== 'mid') continue;

    const city = (o.city ?? '').toLowerCase().replace(/ó/g, 'o');
    const wt = (o.workplace_type ?? o.workplaceType ?? '').toLowerCase();
    const isRemote = o.remote === true || wt === 'remote' || wt === 'hybrid' || wt === 'partly_remote';
    const isKrakow = city === 'krakow' || city.startsWith('krak');
    if (!isRemote && !isKrakow) continue;

    const empTypes: Array<{ salary?: { from: number; to: number; currency: string } | null }> =
      o.employment_types ?? o.employmentTypes ?? [];
    const salary = empTypes.find((e) => e.salary)?.salary ?? null;

    results.push({
      title: o.title ?? 'Unknown',
      company: o.company_name ?? o.company?.name ?? 'Unknown',
      salary_from: salary ? Math.round(salary.from) : null,
      salary_to: salary ? Math.round(salary.to) : null,
      currency: salary?.currency ?? null,
      url: o.url ?? `https://justjoin.it/job-offers/${o.slug ?? o.id}`,
      source: 'justjoin',
      location: o.city ?? null,
      remote: isRemote,
    });
  }
  return results;
}

async function scrapeNoFluffJobs(): Promise<OfferInput[]> {
  // Broad query — filter for junior/mid client-side so more results survive
  const res = await fetch(
    'https://nofluffjobs.com/api/search/posting?criteria=angular&salaryCurrency=PLN&salaryPeriod=month',
    { headers: { ...BROWSER_HEADERS, Referer: 'https://nofluffjobs.com/' }, signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) throw new Error(`non-JSON (${contentType.split(';')[0]})`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  const postings: any[] = data.postings ?? data.items ?? [];

  const results: OfferInput[] = [];
  for (const o of postings) {
    // Seniority: accept junior, mid, or unknown
    const seniority: string[] = Array.isArray(o.seniority)
      ? o.seniority.map((s: unknown) => String(s).toLowerCase())
      : [];
    const isJuniorMid =
      seniority.length === 0 ||
      seniority.some((s) => s === 'junior' || s === 'mid' || s === 'regular');
    if (!isJuniorMid) continue;

    // Location: Kraków or remote
    const places: string[] = (o.location?.places ?? []).map(
      (p: { city?: string }) => (p.city ?? '').toLowerCase().replace(/ó/g, 'o'),
    );
    const fullyRemote = o.location?.fullyRemote === true || o.remote === true;
    const isKrakow = places.some((c) => c === 'krakow' || c.startsWith('krak'));
    if (!fullyRemote && !isKrakow) continue;

    results.push({
      title: o.name ?? o.title ?? 'Unknown',
      company: o.company?.name ?? 'Unknown',
      salary_from: o.salary?.from ?? null,
      salary_to: o.salary?.to ?? null,
      currency: o.salary?.currency ?? null,
      url: o.url ?? `https://nofluffjobs.com/pl/job/${o.id}`,
      source: 'nofluffjobs',
      location: o.location?.places?.[0]?.city ?? null,
      remote: fullyRemote,
    });
  }
  return results;
}

async function scrapeRemotive(): Promise<OfferInput[]> {
  // Reliable free API — all remote Angular jobs globally
  const res = await fetch(
    'https://remotive.io/api/remote-jobs?category=software-dev&search=angular&limit=50',
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  const jobs: any[] = data.jobs ?? [];

  return jobs
    .filter((j) => {
      const titleLow = (j.title ?? '').toLowerCase();
      return titleLow.includes('angular') || (j.tags ?? []).includes('angular');
    })
    .map((j) => ({
      title: j.title ?? 'Unknown',
      company: j.company_name ?? 'Unknown',
      salary_from: null,
      salary_to: null,
      currency: null,
      url: j.url ?? '',
      source: 'remotive' as const,
      location: j.candidate_required_location ?? null,
      remote: true,
    }))
    .filter((o) => o.url);
}

// ── fetch + save ──────────────────────────────────────────────────────────────

export interface FetchSummary {
  fetched: number;
  saved: number;
  sources: { justjoin: string; nofluffjobs: string; remotive: string };
}

export async function fetchAndSaveJobOffers(env: Env): Promise<FetchSummary> {
  const collected: OfferInput[] = [];
  const sources = { justjoin: '', nofluffjobs: '', remotive: '' };

  try {
    const r = await scrapeJustJoinIT();
    collected.push(...r);
    sources.justjoin = `${r.length} ofert`;
    console.log(`[job-search] JJI: ${r.length}`);
  } catch (e) {
    sources.justjoin = `błąd: ${String(e).replace('Error: ', '')}`;
    console.error('[job-search] JJI failed:', String(e));
  }

  try {
    const r = await scrapeNoFluffJobs();
    collected.push(...r);
    sources.nofluffjobs = `${r.length} ofert`;
    console.log(`[job-search] NFJ: ${r.length}`);
  } catch (e) {
    sources.nofluffjobs = `błąd: ${String(e).replace('Error: ', '')}`;
    console.error('[job-search] NFJ failed:', String(e));
  }

  try {
    const r = await scrapeRemotive();
    collected.push(...r);
    sources.remotive = `${r.length} ofert`;
    console.log(`[job-search] Remotive: ${r.length}`);
  } catch (e) {
    sources.remotive = `błąd: ${String(e).replace('Error: ', '')}`;
    console.error('[job-search] Remotive failed:', String(e));
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

jobSearchRouter.post('/fetch', async (c) => {
  const result = await fetchAndSaveJobOffers(c.env);
  return c.json(result);
});

jobSearchRouter.patch('/offers/:id/dismiss', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabase(c.env);
  const { error } = await supabase.from('job_offers').update({ dismissed: true }).eq('id', id);
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.body(null, 204);
});
