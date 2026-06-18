import type { Env } from '../types';
import { createSupabase } from '../lib/supabase';
import { sendTelegram } from '../lib/telegram';

/** Alert once for subscriptions renewing within the next 7 days. */
export async function remindSubscriptions(env: Env): Promise<void> {
  const supabase = createSupabase(env);
  const today = new Date().toISOString().slice(0, 10);
  const inSevenDays = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .not('renewal_date', 'is', null)
    .gte('renewal_date', today)
    .lte('renewal_date', inSevenDays);

  if (error || !data?.length) return;

  for (const sub of data) {
    const kvKey = `sub_alert:${sub.id}:${today}`;
    if (await env.TOKENS.get(kvKey)) continue;

    const renewalDate = sub.renewal_date as string;
    const daysUntil = Math.round(
      (new Date(renewalDate).getTime() - new Date(today).getTime()) / 86_400_000,
    );
    const cycleLabel =
      sub.billing_cycle === 'monthly' ? 'miesiąc'
      : sub.billing_cycle === 'yearly' ? 'rok'
      : 'tydzień';
    const icon = sub.icon ? `${sub.icon} ` : '';
    const dayWord = daysUntil === 1 ? 'dzień' : 'dni';

    const msg =
      `🔔 <b>Przypomnienie o subskrypcji</b>\n` +
      `📦 ${icon}${sub.name} — odnawia się za ${daysUntil} ${dayWord} (${renewalDate})\n` +
      `💰 ${sub.cost_pln} PLN / ${cycleLabel}\n` +
      `Czy chcesz ją anulować?`;

    const ok = await sendTelegram(env, msg);
    if (ok) {
      await env.TOKENS.put(kvKey, '1', { expirationTtl: 8 * 86_400 });
    }
  }
}
