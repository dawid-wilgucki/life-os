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

async function scrapeJustJoinIT(): Promise<OfferInput[]> {
  const res = await fetch('https://justjoin.it/api/offers', {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`JJI responded ${res.status}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = await res.json();
  const results: OfferInput[] = [];

  for (const o of all) {
    // Tech filter: Angular
    const icon = (o.marker_icon ?? '').toLowerCase();
    const skills: string[] = (o.skills ?? []).map((s: { name: string }) => s.name.toLowerCase());
    const titleLow = (o.title ?? '').toLowerCase();
    const isAngular = icon === 'angular' || skills.includes('angular') || titleLow.includes('angular');
    if (!isAngular) continue;

    // Seniority filter: junior or mid only
    const lvl = (o.experience_level ?? '').toLowerCase();
    if (lvl && lvl !== 'junior' && lvl !== 'mid') continue;

    // Location filter: Kraków or remote/hybrid
    const city = (o.city ?? '').toLowerCase().replace(/ó/g, 'o'); // ó → o
    const wt = (o.workplace_type ?? '').toLowerCase();
    const isRemote = o.remote === true || wt === 'remote' || wt === 'hybrid' || wt === 'partly_remote';
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
    // Angular in Kraków
    'criteria=requirement%3Dangular+city%3Dkrakow',
    // Angular fully remote
    'criteria=requirement%3Dangular&remote=true',
  ];

  for (const qs of searches) {
    const res = await fetch(`https://nofluffjobs.com/api/search/posting?${qs}&salaryCurrency=PLN&salaryPeriod=month`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const postings: any[] = data.postings ?? data.items ?? [];

    for (const o of postings) {
      // Seniority filter
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

export async function fetchAndSaveJobOffers(env: Env): Promise<{ fetched: number; saved: number }> {
  const collected: OfferInput[] = [];

  try {
    const jji = await scrapeJustJoinIT();
    collected.push(...jji);
    console.log(`[job-search] JustJoin.IT: ${jji.length} offers matched`);
  } catch (e) {
    console.error('[job-search] JustJoin.IT failed:', String(e));
  }

  try {
    const nfj = await scrapeNoFluffJobs();
    collected.push(...nfj);
    console.log(`[job-search] NoFluffJobs: ${nfj.length} offers matched`);
  } catch (e) {
    console.error('[job-search] NoFluffJobs failed:', String(e));
  }

  if (collected.length === 0) return { fetched: 0, saved: 0 };

  const supabase = createSupabase(env);
  const { error } = await supabase
    .from('job_offers')
    .upsert(collected, { onConflict: 'url', ignoreDuplicates: true });

  if (error) {
    console.error('[job-search] upsert failed:', error.message);
    return { fetched: collected.length, saved: 0 };
  }

  return { fetched: collected.length, saved: collected.length };
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

// POST /api/job-search/fetch — manual trigger (also used by cron)
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
