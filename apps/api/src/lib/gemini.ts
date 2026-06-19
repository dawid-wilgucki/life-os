import type { Env } from '../types';

/** Primary model; no announced shutdown date as of mid-2026. */
const PRIMARY_MODEL = 'gemini-3.5-flash';
/** Fallback used when the primary is overloaded (HTTP 429/503). */
const FALLBACK_MODEL = 'gemini-2.5-flash';

/** Retries per model on transient overload before moving on. */
const MAX_RETRIES = 2;
/** HTTP statuses Google returns for transient overload / rate limiting. */
const TRANSIENT_STATUS = new Set([429, 503]);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function endpoint(model: string, key: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
}

/**
 * Calls Gemini `generateContent`, retrying the primary model on transient
 * overload (429/503) with exponential backoff, then falling back to a more
 * established model. Returns the first successful response, or the last error
 * response if every attempt fails. The caller is responsible for reading the
 * body and mapping errors.
 */
export async function geminiGenerate(env: Env, body: unknown): Promise<Response> {
  const key = env.GEMINI_API_KEY ?? '';
  const payload = JSON.stringify(body);
  let lastRes: Response | null = null;

  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetch(endpoint(model, key), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      });
      if (res.ok) return res;
      lastRes = res;
      // Hard errors (bad key, bad request, model not found) won't fix themselves.
      if (!TRANSIENT_STATUS.has(res.status)) return res;
      // Transient: back off before retrying the same model (400ms, 800ms).
      if (attempt < MAX_RETRIES) await sleep(400 * 2 ** attempt);
    }
    // Exhausted retries for this model — fall through to the fallback model.
  }

  return lastRes as Response;
}
