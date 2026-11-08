import type { Env } from '../types';
import { runShellyPoll } from '../shelly/poll';

/** Every 15 min: Shelly status snapshot, alerts, and a small cloud-history backfill step. */
export async function pollShelly(env: Env): Promise<void> {
  const result = await runShellyPoll(env, { source: 'poll', backfill: true, notify: true });
  if (!result.ok) console.warn('[cron:shelly] poll finished with', result.error);
}
