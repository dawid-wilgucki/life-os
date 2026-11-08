import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../types';
import { sendTelegram } from '../lib/telegram';
import type { AlertRow, SettingsRow } from './db';
import { escapeHtml, type Verdict } from './rules';
import { fmtDateTime, inQuietHours } from './time';

const keyOf = (deviceId: string | null, rule: string) => `${deviceId ?? ''}|${rule}`;

export interface SilentResolve {
  deviceId: string;
  resolution: 'break' | 'disabled';
  /** Rules left untouched (e.g. break_activity stays live during a break). */
  keepRules?: string[];
}

/**
 * Turn verdicts into episodes: open on "firing" (one per device+rule — the
 * partial unique index enforces it), close after N consecutive "ok".
 * Episodes of devices in a break / disabled are closed silently.
 */
export async function applyVerdicts(
  db: SupabaseClient,
  verdicts: Verdict[],
  openAlerts: AlertRow[],
  silent: SilentResolve[],
  now: Date,
): Promise<void> {
  const nowIso = now.toISOString();
  const open = new Map(openAlerts.map((a) => [keyOf(a.device_id, a.rule), a]));
  const changed = new Map<string, AlertRow>();
  const inserts: Partial<AlertRow>[] = [];

  for (const v of verdicts) {
    const cur = open.get(keyOf(v.deviceId, v.rule));
    if (v.status === 'firing') {
      if (!cur) {
        inserts.push({
          device_id: v.deviceId,
          rule: v.rule,
          severity: v.severity ?? 'warning',
          message: v.message ?? v.rule,
          resolve_message: v.resolveMessage ?? null,
          details: v.details ?? null,
          opened_at: nowIso,
        });
      } else if (cur.ok_streak > 0) {
        changed.set(cur.id, { ...cur, ok_streak: 0 });
      }
    } else if (v.status === 'ok' && cur) {
      const streak = cur.ok_streak + 1;
      const resolved = streak >= v.resolveAfter;
      changed.set(cur.id, {
        ...cur,
        ok_streak: streak,
        resolved_at: resolved ? nowIso : null,
        resolution: resolved ? 'normal' : null,
        resolve_message: v.resolveMessage ?? cur.resolve_message,
      });
    }
  }

  for (const s of silent) {
    for (const a of openAlerts) {
      if (a.device_id !== s.deviceId || s.keepRules?.includes(a.rule)) continue;
      changed.set(a.id, {
        ...a,
        resolved_at: nowIso,
        resolution: s.resolution,
        // Never announce these: the user put the device on a break / disabled it.
        notified_resolved_at: nowIso,
      });
    }
  }

  if (changed.size) {
    const { error } = await db.from('shelly_alerts').upsert([...changed.values()], { onConflict: 'id' });
    if (error) console.error('[shelly] alert update failed', error.message);
  }
  for (const row of inserts) {
    const { error } = await db.from('shelly_alerts').insert(row);
    // 23505 = another invocation opened the same episode concurrently — fine.
    if (error && error.code !== '23505') console.error('[shelly] alert insert failed', error.message);
  }
}

/**
 * Send pending Telegram messages unless we are inside quiet hours — then they
 * wait (an episode still open at the end of quiet hours is announced, one that
 * already ended is only kept in history).
 */
export async function sendPendingNotifications(
  env: Env,
  db: SupabaseClient,
  settings: SettingsRow,
  deviceNames: Map<string, string>,
  now: Date,
): Promise<void> {
  if (inQuietHours(now, settings.quiet_from, settings.quiet_to)) return;
  const since = new Date(now.getTime() - 3 * 86_400_000).toISOString();

  const [openRes, resolvedRes] = await Promise.all([
    db.from('shelly_alerts').select('*').is('resolved_at', null).is('notified_open_at', null),
    db
      .from('shelly_alerts')
      .select('*')
      .eq('resolution', 'normal')
      .not('notified_open_at', 'is', null)
      .is('notified_resolved_at', null)
      .gte('resolved_at', since),
  ]);
  if (openRes.error || resolvedRes.error) {
    console.error('[shelly] pending notifications query failed', openRes.error?.message ?? resolvedRes.error?.message);
    return;
  }

  const updates: AlertRow[] = [];
  for (const a of (openRes.data ?? []) as AlertRow[]) {
    const late = now.getTime() - new Date(a.opened_at).getTime() > 20 * 60_000;
    const icon = a.severity === 'critical' ? '🔴' : '🟠';
    const text = `${icon} ${a.message}${late ? `\n<i>Od ${fmtDateTime(a.opened_at)}.</i>` : ''}`;
    if (await sendTelegram(env, text)) updates.push({ ...a, notified_open_at: now.toISOString() });
  }
  for (const a of (resolvedRes.data ?? []) as AlertRow[]) {
    const fallback = a.device_id ? `<b>${escapeHtml(deviceNames.get(a.device_id) ?? a.device_id)}</b>: wróciło do normy.` : 'Wróciło do normy.';
    const text = `🟢 ${a.resolve_message ?? fallback}`;
    if (await sendTelegram(env, text)) updates.push({ ...a, notified_resolved_at: now.toISOString() });
  }
  if (updates.length) {
    const { error } = await db.from('shelly_alerts').upsert(updates, { onConflict: 'id' });
    if (error) console.error('[shelly] marking notifications failed', error.message);
  }
}
