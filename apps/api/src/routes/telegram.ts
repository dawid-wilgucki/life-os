import { Hono } from 'hono';
import type { AppContext } from '../types';
import { createSupabase } from '../lib/supabase';
import { sendTelegram } from '../lib/telegram';

export const telegramRouter = new Hono<AppContext>();

// POST /api/telegram/webhook — inbound bot updates (public; no JWT).
// Register with:
//   https://api.telegram.org/bot<TOKEN>/setWebhook?url=<worker>/api/telegram/webhook
// We accept only messages from TELEGRAM_CHAT_ID and handle `/inbox <text>`.
telegramRouter.post('/webhook', async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update = await c.req.json<any>().catch(() => null);
  const msg = update?.message;
  if (!msg) return c.body(null, 200);

  const chatId = String(msg.chat?.id ?? '');
  if (chatId !== c.env.TELEGRAM_CHAT_ID) return c.body(null, 200); // ignore strangers

  const text: string = msg.text ?? '';
  if (text.startsWith('/inbox')) {
    const payload = text.replace(/^\/inbox(@\w+)?/, '').trim();
    if (!payload) {
      await sendTelegram(c.env, 'Usage: <code>/inbox your note here</code>');
      return c.body(null, 200);
    }
    const supabase = createSupabase(c.env);
    const { error } = await supabase
      .from('inbox_items')
      .insert({ text: payload, source: 'telegram', status: 'new' });
    await sendTelegram(
      c.env,
      error ? '⚠️ Failed to save to inbox.' : `📥 Saved to inbox:\n${payload}`,
    );
  }

  return c.body(null, 200);
});
