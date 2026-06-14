import type { Env } from '../types';
import { remindMaintenance } from './maintenance';
import { nudgeHabits } from './habits';

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
 *   "0 19/20 * * *"    -> habit nudge, gated to 21:00 Europe/Warsaw (one fires
 *                         per day: 19:00 UTC in summer, 20:00 UTC in winter)
 */
export async function handleScheduled(cron: string, env: Env): Promise<void> {
  if (cron === '0 6 * * *') {
    await remindMaintenance(env);
    return;
  }
  if (cron === '0 19 * * *' || cron === '0 20 * * *') {
    if (warsawHour() === 21) await nudgeHabits(env);
  }
}
