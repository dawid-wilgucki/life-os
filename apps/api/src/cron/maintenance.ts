import type { Env } from '../types';
import { createSupabase } from '../lib/supabase';
import { sendTelegram } from '../lib/telegram';

/** Notify (once) about maintenance items due within the next 3 days. */
export async function remindMaintenance(env: Env): Promise<void> {
  const supabase = createSupabase(env);
  const cutoff = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('maintenance_items')
    .select('*')
    .lte('next_due', cutoff)
    .eq('reminder_sent', false);
  if (error || !data?.length) return;

  for (const item of data) {
    const ok = await sendTelegram(
      env,
      `🔧 Maintenance due ${item.next_due}: <b>${item.name}</b> (${item.category})`,
    );
    if (ok) await supabase.from('maintenance_items').update({ reminder_sent: true }).eq('id', item.id);
  }
}
