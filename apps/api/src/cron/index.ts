import type { Env } from '../types';
import { remindMaintenance } from './maintenance';
import { remindSubscriptions } from './subscriptions';
import { cronFetchJobOffers } from './job-search';
import { pollShelly } from './shelly';

/** Current hour (0-23) in Europe/Warsaw, DST-aware. */
function warsawHour(): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw',
      hour: '2-digit',
      hour12: false,
    }).format(new Date()),
  );
}

/**
 * Dispatch scheduled work by which cron trigger fired (all times UTC).
 *   "0 6 * * *"        -> morning maintenance reminders
 *                         + job-search fetch when Warsaw hour = 8 (CEST / summer)
 *   "0 7 * * *"        -> job-search fetch when Warsaw hour = 8 (CET / winter)
 *   "0 8 * * *"        -> subscription renewal reminders
 *   every 15 min       -> Shelly devices: snapshot, alerts, cloud-history backfill
 */
export async function handleScheduled(cron: string, env: Env): Promise<void> {
  if (cron === '0 6 * * *') {
    await remindMaintenance(env);
    if (warsawHour() === 8) await cronFetchJobOffers(env); // CEST: 06:00 UTC = 08:00 Warsaw
    return;
  }
  if (cron === '0 7 * * *') {
    if (warsawHour() === 8) await cronFetchJobOffers(env); // CET:  07:00 UTC = 08:00 Warsaw
    return;
  }
  if (cron === '0 8 * * *') {
    await remindSubscriptions(env);
    return;
  }
  if (cron === '*/15 * * * *') {
    await pollShelly(env);
  }
}
