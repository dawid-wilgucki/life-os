import { Hono, type Context } from 'hono';
import type { ShellyRun } from '@life-os/shared-types';
import type { AppContext } from '../types';
import { createSupabase } from '../lib/supabase';
import type { StateRow } from '../shelly/db';

/**
 * Public receiver for Shelly webhooks (Gen2+ device Actions). Authorised only
 * by the secret in the path. Configure on the device (local web UI → Actions):
 *
 *   switch.on : https://<worker>/hooks/shelly/<SECRET>?id=<device-id>&ev=on&e=${status["switch:0"].aenergy.total}
 *   switch.off: https://<worker>/hooks/shelly/<SECRET>?id=<device-id>&ev=off&e=${status["switch:0"].aenergy.total}
 *
 * Gives exact start/stop and energy per run; the 15-min poll stays the source
 * of truth (webhooks are fire-and-forget).
 */
export const shellyHooksRouter = new Hono<AppContext>();

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const numOrNull = (v: string | undefined) => {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function handle(c: Context<AppContext>) {
  const secret = c.env.SHELLY_WEBHOOK_SECRET;
  if (!secret || !safeEqual(c.req.param('secret') ?? '', secret)) return c.json({ error: 'not_found' }, 404);

  const id = (c.req.query('id') ?? '').toLowerCase();
  const ev = c.req.query('ev');
  if (!id || (ev !== 'on' && ev !== 'off')) return c.json({ error: 'bad_request' }, 400);
  const energy = numOrNull(c.req.query('e'));
  const power = numOrNull(c.req.query('p'));

  const db = createSupabase(c.env);
  const [{ data: device }, { data: stateRow }] = await Promise.all([
    db.from('shelly_devices').select('id, enabled').eq('id', id).maybeSingle(),
    db.from('shelly_device_state').select('*').eq('device_id', id).maybeSingle(),
  ]);
  if (!device || !device.enabled) return c.json({ error: 'unknown_device' }, 404);

  const now = new Date();
  const nowIso = now.toISOString();
  const state = stateRow as StateRow | null;

  const { error: sampleErr } = await db.from('shelly_samples').insert({
    device_id: id,
    ts: nowIso,
    source: 'webhook',
    event: ev,
    output: ev === 'on',
    apower_w: power,
    energy_total_wh: energy,
  });
  if (sampleErr) console.error('[shelly-hook] sample insert failed', sampleErr.message);

  const patch: Partial<StateRow> & { device_id: string; updated_at: string } = {
    device_id: id,
    output: ev === 'on',
    last_active_at: nowIso,
    updated_at: nowIso,
  };
  if (ev === 'on') {
    patch.active_since = nowIso;
    patch.active_since_exact = true;
    patch.active_energy_start_wh = energy ?? state?.last_energy_wh ?? null;
  } else {
    const start = state?.active_since ?? null;
    if (start) {
      const startE = state?.active_energy_start_wh ?? null;
      const wh = energy !== null && startE !== null ? Math.max(0, energy - startE) : null;
      const exact = Boolean(state?.active_since_exact);
      const hours = (now.getTime() - new Date(start).getTime()) / 3_600_000;
      const run: ShellyRun = {
        start,
        end: nowIso,
        energyWh: wh === null ? null : Math.round(wh * 10) / 10,
        avgW: exact && wh !== null && hours > 0 ? Math.round(wh / hours) : null,
        exact,
      };
      patch.last_run = run;
    }
    patch.active_since = null;
    patch.active_since_exact = false;
    patch.active_energy_start_wh = null;
  }
  if (energy !== null) patch.last_energy_wh = energy;

  const { error: stateErr } = await db.from('shelly_device_state').upsert(patch, { onConflict: 'device_id' });
  if (stateErr) console.error('[shelly-hook] state update failed', stateErr.message);
  return c.body(null, 204);
}

shellyHooksRouter.get('/:secret', handle);
shellyHooksRouter.post('/:secret', handle);
