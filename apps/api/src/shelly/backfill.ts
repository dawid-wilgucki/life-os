import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../types';
import { getDailyConsumption, ShellyError, SHELLY_CALL_GAP_MS, sleep } from '../lib/shelly';
import type { DeviceRow, StateRow } from './db';
import { localParts } from './time';

/**
 * History bonus from the (undocumented) cloud statistics endpoint: one month
 * of daily kWh per call, walking backwards from the current month. Own counter
 * samples stay the source of truth; cloud days are only shown before the first
 * own sample (see shelly_energy_series).
 *
 * Bounded per invocation (shared 1 req/s budget, 50 subrequests on Free).
 */
const MAX_MONTHS_BACK = 36;
const STOP_AFTER_EMPTY_MONTHS = 12;
const MAX_ERRORS = 5;

const pad = (n: number) => String(n).padStart(2, '0');

function monthStart(y: number, m: number): string {
  return `${y}-${pad(m)}-01`;
}

function shiftMonth(date: string, delta: number): string {
  const [y, m] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return monthStart(t.getUTCFullYear(), t.getUTCMonth() + 1);
}

function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m, 0));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export async function backfillStep(
  env: Env,
  db: SupabaseClient,
  devices: DeviceRow[],
  states: Map<string, StateRow>,
  now: Date,
  maxCalls = 2,
): Promise<void> {
  const today = localParts(now);
  const currentMonth = monthStart(today.y, today.m);
  const limit = shiftMonth(currentMonth, -MAX_MONTHS_BACK);

  let calls = 0;
  for (const device of devices) {
    if (calls >= maxCalls) break;
    if (!device.enabled || !device.has_power_meter) continue;
    const st = states.get(device.id);
    if (!st || st.backfill_done) continue;

    let month = st.backfill_month ?? currentMonth;
    let empty = st.backfill_empty_months;
    let errors = st.backfill_errors;
    let done = false;

    while (calls < maxCalls && !done) {
      if (month < limit) {
        done = true;
        break;
      }
      calls++;
      await sleep(SHELLY_CALL_GAP_MS);
      try {
        const end = monthEnd(month) > today.date ? today.date : monthEnd(month);
        const rows = await getDailyConsumption(env, device.id, device.channel, month, end);
        const valid = rows.filter((r) => r.day >= month && r.day <= end);
        if (valid.length) {
          const { error } = await db.from('shelly_cloud_daily').upsert(
            valid.map((r) => ({
              device_id: device.id,
              day: r.day,
              wh: r.wh,
              voltage_avg: r.voltageAvg,
              fetched_at: now.toISOString(),
            })),
            { onConflict: 'device_id,day' },
          );
          if (error) throw new Error(`db: ${error.message}`);
        }
        const total = valid.reduce((s, r) => s + r.wh, 0);
        empty = total > 0 ? 0 : empty + 1;
        errors = 0;
        month = shiftMonth(month, -1);
        if (empty >= STOP_AFTER_EMPTY_MONTHS || month < limit) done = true;
      } catch (err) {
        if (err instanceof ShellyError && err.kind === 'rate_limit') {
          calls = maxCalls; // stop for this invocation, retry next poll
          break;
        }
        errors++;
        console.error(`[shelly] backfill ${device.id} ${month} failed:`, err instanceof Error ? err.message : String(err));
        if (errors >= MAX_ERRORS) done = true;
        break;
      }
    }

    const { error } = await db.from('shelly_device_state').upsert(
      {
        device_id: device.id,
        backfill_month: month,
        backfill_empty_months: empty,
        backfill_errors: errors,
        backfill_done: done,
      },
      { onConflict: 'device_id' },
    );
    if (error) console.error('[shelly] backfill state update failed', error.message);
  }
}
