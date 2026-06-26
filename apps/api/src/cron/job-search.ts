import type { Env } from '../types';
import { fetchAndSaveJobOffers } from '../routes/job-search';

export async function cronFetchJobOffers(env: Env): Promise<void> {
  try {
    const result = await fetchAndSaveJobOffers(env);
    console.log(`[cron:job-search] fetched=${result.fetched} saved=${result.saved}`);
  } catch (e) {
    console.error('[cron:job-search] failed:', String(e));
  }
}
