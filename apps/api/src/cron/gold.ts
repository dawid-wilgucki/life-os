import type { Env } from '../types';
import type { GoldOffer, GoldOpportunities } from '@life-os/shared-types';
import { fetchNumiOffers, isOpportunity } from '../lib/numitracker';
import { sendTelegram } from '../lib/telegram';

const NBP_GOLD_URL = 'https://api.nbp.pl/api/cenyzlota/?format=json';

async function nbpSpot(): Promise<{ spot: number; asOf?: string } | null> {
  try {
    const res = await fetch(NBP_GOLD_URL);
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ data?: string; cena?: number }>;
    const e = data[data.length - 1];
    return e?.cena != null ? { spot: e.cena, asOf: e.data } : null;
  } catch {
    return null;
  }
}

/** Daily gold opportunity check: dedup via KV, send Telegram, store snapshot. */
export async function checkGoldOpportunities(env: Env): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const [offers, nbp] = await Promise.all([fetchNumiOffers(2000), nbpSpot()]);
  const opps = offers.filter((o) => isOpportunity(o.price, o.overSpot));

  // Collect offers not yet notified (KV dedup, TTL 24h to avoid cross-day repeats).
  const newOpps: GoldOffer[] = [];
  for (const o of opps) {
    if (!(await env.TOKENS.get(`gold_opp:${o.id}:${Math.round(o.price)}`))) {
      newOpps.push(o);
    }
  }

  if (newOpps.length > 0) {
    const spotStr = nbp ? `${nbp.spot.toFixed(2)} PLN/g` : 'brak danych';
    const rows = newOpps.slice(0, 12).map((o) => {
      const g = o.weightGrams != null ? `${o.weightGrams}g` : '—';
      const cena = `${Math.round(o.price)} zł`;
      const prem = `${o.overSpot.toFixed(1)}%`;
      const dealer = (o.dealer ?? '—').slice(0, 12);
      return `${g.padEnd(6)}| ${cena.padEnd(8)}| ${prem.padEnd(6)}| ${dealer}`;
    });
    const table = `<code>gram  | cena    | prem  | dealer\n${rows.join('\n')}</code>`;
    const more = newOpps.length > 12 ? `\n+${newOpps.length - 12} więcej…` : '';
    const msg =
      `🥇 <b>${newOpps.length} nowych okazji złota</b>\n` +
      `📅 ${today} | SPOT: ${spotStr}\n\n${table}${more}`;

    const ok = await sendTelegram(env, msg);
    if (ok) {
      for (const o of newOpps) {
        await env.TOKENS.put(`gold_opp:${o.id}:${Math.round(o.price)}`, '1', {
          expirationTtl: 86400,
        });
      }
    }
  }

  // Store daily snapshot for the UI tile (TTL 26h so it lives until next cron).
  const snapshot: GoldOpportunities = {
    date: today,
    spotPerGram: nbp?.spot ?? null,
    count: opps.length,
    offers: opps,
  };
  await env.TOKENS.put(`gold_opportunities:${today}`, JSON.stringify(snapshot), {
    expirationTtl: 26 * 3600,
  });
}
