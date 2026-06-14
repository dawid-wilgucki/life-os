import type { Env } from '../types';
import { createSupabase } from '../lib/supabase';
import { sendTelegram } from '../lib/telegram';

/** Nudge for active habits not yet checked in today. */
export async function nudgeHabits(env: Env): Promise<void> {
  const supabase = createSupabase(env);
  const today = new Date().toISOString().slice(0, 10);

  const { data: habits } = await supabase.from('habits').select('id, name, icon').eq('active', true);
  if (!habits?.length) return;

  const { data: checks } = await supabase.from('habit_checks').select('habit_id').eq('date', today);
  const done = new Set((checks ?? []).map((c) => c.habit_id as string));

  const pending = habits.filter((h) => !done.has(h.id as string));
  if (!pending.length) return;

  const list = pending.map((h) => `${h.icon} ${h.name}`).join('\n');
  await sendTelegram(env, `⏰ Habits not done yet today:\n${list}`);
}
