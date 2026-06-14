import type { Env } from '../types';

/**
 * Fire a Telegram message via the bot API. Best-effort: logs and swallows
 * failures so a notification problem never breaks the calling request/cron.
 */
export async function sendTelegram(
  env: Env,
  text: string,
  chatId: string = env.TELEGRAM_CHAT_ID,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      },
    );
    if (!res.ok) {
      console.error('telegram sendMessage failed', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('telegram sendMessage error', err);
    return false;
  }
}
