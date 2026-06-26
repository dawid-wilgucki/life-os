import type { Env } from '../types';
import { remindMaintenance } from './maintenance';
import { nudgeHabits } from './habits';
import { remindSubscriptions } from './subscriptions';
import { cronFetchJobOffers } from './job-search';

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
 *   "0 19/20 * * *"    -> habit nudge, gated to 21:00 Europe/Warsaw (one fires
 *                         per day: 19:00 UTC in summer, 20:00 UTC in winter)
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
  if (cron === '0 19 * * *' || cron === '0 20 * * *') {
    if (warsawHour() === 21) await nudgeHabits(env);
  }
}
