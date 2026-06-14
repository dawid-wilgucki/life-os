import type { Env } from '../types';
import { remindMaintenance } from './maintenance';

/**
 * Dispatch scheduled work by which cron trigger fired (all times UTC).
 *   "0 6 * * *"  -> morning maintenance reminders
 *   "0 19/20 * * *" -> 21:00 Europe/Warsaw habit nudge (DST-gated; added with habits)
 */
export async function handleScheduled(cron: string, env: Env): Promise<void> {
  if (cron === '0 6 * * *') {
    await remindMaintenance(env);
  }
  // Habit nudges (19:00/20:00 UTC) are wired up in the habits module.
}
