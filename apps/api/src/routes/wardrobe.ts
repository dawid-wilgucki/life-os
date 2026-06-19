import { Hono } from 'hono';
import type { Wardrobe, WardrobeItem, WardrobeSection, WardrobeSuggestion } from '@life-os/shared-types';
import type { AppContext, Env } from '../types';
import { requireAuth } from '../middleware/auth';
import { googleFetch } from '../lib/google';
import { verifySession } from '../lib/jwt';

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const WARDROBE_JSON = 'garderoba_ubran_nowych_stan.json';
const SECTIONS: WardrobeSection[] = ['gora', 'dol', 'buty', 'bielizna_i_dodatki', 'silownia'];

export const wardrobeRouter = new Hono<AppContext>();

async function findFileId(env: Env, accountId: string, name: string): Promise<string | null> {
  const q = `name = '${name.replace(/'/g, "\\'")}' and trashed = false`;
  const url = `${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive&pageSize=1`;
  const res = await googleFetch(env, accountId, url);
  if (!res.ok) return null;
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchRawJson(env: Env, accountId: string): Promise<{ fileId: string; raw: any } | null> {
  const fileId = await findFileId(env, accountId, WARDROBE_JSON);
  if (!fileId) return null;
  const res = await googleFetch(env, accountId, `${DRIVE}/${fileId}?alt=media`);
  if (!res.ok) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await res.json()) as any;
  return { fileId, raw };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function writeRawJson(env: Env, accountId: string, fileId: string, raw: unknown): Promise<boolean> {
  const res = await googleFetch(env, accountId, `${DRIVE_UPLOAD}/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(raw),
  });
  return res.ok;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRawSection(raw: any, section: WardrobeSection): any[] {
  const root = raw?.ubrania ?? raw;
  return Array.isArray(root?.[section]) ? root[section] : [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setRawSection(raw: any, section: WardrobeSection, items: any[]): void {
  if (raw?.ubrania !== undefined) {
    raw.ubrania[section] = items;
  } else {
    raw[section] = items;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(json: any): Wardrobe {
  const out: Wardrobe = {
    gora: [],
    dol: [],
    buty: [],
    bielizna_i_dodatki: [],
    silownia: [],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const push = (section: WardrobeSection, raw: any, idx: number) => {
    const filename = raw.nazwa_pliku_drive ?? raw.nazwaPlikuDrive;
    const item: WardrobeItem = {
      ...raw,
      // Unique even when the source JSON repeats an id (e.g. G020 twice).
      id: `${section}-${idx}-${raw.id ?? ''}`,
      nazwa: raw.nazwa ?? raw.name ?? filename ?? 'Item',
      section,
      nazwaPlikuDrive: filename,
      photoUrl: filename ? `/api/wardrobe/photo/${encodeURIComponent(filename)}` : undefined,
    };
    out[section].push(item);
  };

  if (Array.isArray(json?.items)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    json.items.forEach((it: any, i: number) => {
      const s = (it.section ?? it.kategoria) as WardrobeSection;
      if (SECTIONS.includes(s)) push(s, it, i);
    });
  } else {
    // Sections live under `ubrania` in the real file; fall back to top-level.
    const root = json?.ubrania ?? json;
    for (const s of SECTIONS) {
      const arr = root?.[s];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (Array.isArray(arr)) arr.forEach((it: any, i: number) => push(s, it, i));
    }
  }
  return out;
}

// GET /api/wardrobe/photo/:name — stream a Drive image (cached).
// <img> cannot send Authorization, so the token is accepted via ?token= too.
// Registered before requireAuth so it can do its own (header-or-query) check.
wardrobeRouter.get('/photo/:name', async (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '') ?? c.req.query('token') ?? '';
  const session = token ? await verifySession(token, c.env.JWT_SECRET) : null;
  if (!session) return c.json({ error: 'unauthorized' }, 401);

  const name = decodeURIComponent(c.req.param('name'));
  const cache = caches.default;
  const cacheKey = new Request(
    new URL(`/api/wardrobe/photo/${encodeURIComponent(name)}`, c.req.url).toString(),
  );
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const fileId = await findFileId(c.env, session.sub, name);
  if (!fileId) return c.json({ error: 'photo_not_found' }, 404);

  const driveRes = await googleFetch(c.env, session.sub, `${DRIVE}/${fileId}?alt=media`);
  if (!driveRes.ok) return c.json({ error: 'drive_error' }, 502);

  const res = new Response(driveRes.body, {
    headers: {
      'content-type': driveRes.headers.get('content-type') ?? 'image/jpeg',
      'cache-control': 'public, max-age=86400',
    },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
});

wardrobeRouter.use('*', requireAuth);

const GEMINI_MODEL = 'gemini-3.5-flash';

const WARDROBE_SUGGEST_PROMPT = `Jesteś ekspertem od mody i stylizacji. Przeanalizuj poniższą listę ubrań i zaproponuj 1 KONKRETNY zakup, który najbardziej uzupełni braki w garderobie.

Zwróć WYŁĄCZNIE czysty JSON (bez Markdown, bez wstępów). Pierwszym znakiem musi być "{", ostatnim "}".

Struktura:
{"item":"Nazwa konkretnego produktu (np. 'biała koszula Oxford slim fit')","reason":"Krótkie uzasadnienie, max 2 zdania.","category":"jedna z: gora|dol|buty|bielizna_i_dodatki|silownia"}`;

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// GET /api/wardrobe/suggestion — Gemini-powered purchase recommendation, KV-cached by wardrobe hash.
wardrobeRouter.get('/suggestion', async (c) => {
  const accountId = c.get('session').sub;
  const fileId = await findFileId(c.env, accountId, WARDROBE_JSON);
  if (!fileId) return c.json({ error: 'wardrobe_json_not_found' }, 404);

  const driveRes = await googleFetch(c.env, accountId, `${DRIVE}/${fileId}?alt=media`);
  if (!driveRes.ok) return c.json({ error: 'drive_error' }, 502);
  const rawJson = await driveRes.text();

  const hash = await sha256hex(rawJson);
  const hashKey = `wardrobe:hash:${accountId}`;
  const sugKey = `wardrobe:suggestion:${accountId}`;

  const cachedHash = await c.env.TOKENS.get(hashKey);
  if (cachedHash === hash) {
    const cached = await c.env.TOKENS.get(sugKey);
    if (cached) {
      return c.json({ ...(JSON.parse(cached) as Omit<WardrobeSuggestion, 'cached'>), cached: true });
    }
  }

  if (!c.env.GEMINI_API_KEY) return c.json({ error: 'gemini_not_configured' }, 503);

  const wardrobe = normalize(JSON.parse(rawJson));
  const allItems = (Object.keys(wardrobe) as WardrobeSection[])
    .flatMap((s) => wardrobe[s].map((i) => `${s}: ${i.nazwa}`))
    .join('\n');

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${c.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: WARDROBE_SUGGEST_PROMPT }] },
        contents: [{ parts: [{ text: `Moja garderoba:\n${allItems}` }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.5,
        },
      }),
    },
  );
  if (!geminiRes.ok) return c.json({ error: 'gemini_error', detail: await geminiRes.text() }, 502);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geminiData = (await geminiRes.json()) as any;
  const rawText: string = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  let suggestion: Omit<WardrobeSuggestion, 'cached'>;
  try {
    suggestion = JSON.parse(rawText.trim());
  } catch {
    return c.json({ error: 'gemini_parse_error', raw: rawText.slice(0, 200) }, 502);
  }

  // Store with no TTL — only invalidated when the wardrobe hash changes.
  await c.env.TOKENS.put(hashKey, hash);
  await c.env.TOKENS.put(sugKey, JSON.stringify(suggestion));
  return c.json({ ...suggestion, cached: false } as WardrobeSuggestion);
});

const BIRCZA_WEATHER = { latitude: 49.701879, longitude: 22.414214 };
const OM_BASE_URL = 'https://api.open-meteo.com/v1/forecast';

const OUTFIT_PROMPT = `Jesteś osobistym stylistą. Na podstawie garderoby i pogody zaproponuj konkretny outfit na dziś.

ZASADY:
- Bluzki/koszulki: nie powtarzaj tej samej częściej niż 2 razy w tygodniu
- Spodnie: mogą powtarzać się do 3 razy w tygodniu
- Dopasuj do temperatury i warunków atmosferycznych
- Bądź konkretny: podaj dokładne nazwy ubrań z garderoby

Zwróć WYŁĄCZNIE czysty JSON. Pierwszy znak to "{", ostatni "}".
Format: {"top":"nazwa bluzki","bottom":"nazwa spodni","shoes":"nazwa butów","note":"1-2 zdania stylistycznego komentarza","temp_range":"np. 18–22°C"}`;

// GET /api/wardrobe/outfit-suggestion — Gemini daily outfit recommendation (cached per day in KV).
wardrobeRouter.get('/outfit-suggestion', async (c) => {
  const accountId = c.get('session').sub;
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `outfit:${accountId}:${today}`;
  const force = c.req.query('force') === 'true';

  if (!force) {
    const cached = await c.env.TOKENS.get(cacheKey);
    if (cached) return c.json({ ...JSON.parse(cached), cached: true });
  }

  if (!c.env.GEMINI_API_KEY) return c.json({ error: 'gemini_not_configured' }, 503);

  // Fetch current weather using saved location (fallback to Bircza).
  const locRaw = await c.env.TOKENS.get(`weather_location:${accountId}`);
  const loc = locRaw ? (JSON.parse(locRaw) as typeof BIRCZA_WEATHER) : BIRCZA_WEATHER;
  const omUrl = `${OM_BASE_URL}?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code&timezone=Europe%2FWarsaw`;
  let weatherDesc = 'brak danych pogodowych';
  try {
    const omRes = await fetch(omUrl);
    if (omRes.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const omData = await omRes.json() as any;
      const temp = omData?.current?.temperature_2m;
      if (temp != null) weatherDesc = `${temp}°C`;
    }
  } catch { /* ignore */ }

  // Fetch wardrobe from Drive.
  const fetched = await fetchRawJson(c.env, accountId);
  if (!fetched) return c.json({ error: 'wardrobe_json_not_found' }, 404);
  const wardrobe = normalize(fetched.raw);

  // Build wardrobe text list for Gemini prompt.
  const allItems = (Object.keys(wardrobe) as WardrobeSection[])
    .flatMap((s) => wardrobe[s].map((i) => `${s}: ${i.nazwa}`))
    .join('\n');

  // Retrieve last 7 days of suggestions for variety context.
  const { keys } = await c.env.TOKENS.list({ prefix: `outfit:${accountId}:` });
  const recentDays = keys
    .map((k) => k.name)
    .sort()
    .slice(-7)
    .filter((k) => k !== cacheKey);
  const recentRaw = await Promise.all(recentDays.map((k) => c.env.TOKENS.get(k)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recentOutfits = recentRaw.flatMap((r) => (r ? [(JSON.parse(r) as any).top] : []));
  const recentNote = recentOutfits.length
    ? `\nOstatnio noszone bluzki (unikaj powtórzeń): ${recentOutfits.join(', ')}`
    : '';

  const userPrompt =
    `Pogoda dziś: ${weatherDesc}\nMoja garderoba:\n${allItems}${recentNote}`;

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${c.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: OUTFIT_PROMPT }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.8 },
      }),
    },
  );
  if (!geminiRes.ok) {
    const detail = await geminiRes.text();
    console.error('Gemini outfit error:', geminiRes.status, detail);
    return c.json({ error: 'gemini_error', status: geminiRes.status, detail }, 502);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geminiData = (await geminiRes.json()) as any;
  const rawText: string = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let suggestion: Record<string, any>;
  try {
    suggestion = JSON.parse(rawText.trim());
    if (!suggestion.top || !suggestion.bottom) throw new Error('invalid shape');
  } catch {
    return c.json({ error: 'gemini_parse_error', raw: rawText.slice(0, 300) }, 502);
  }

  await c.env.TOKENS.put(cacheKey, JSON.stringify(suggestion), { expirationTtl: 24 * 3600 });
  return c.json({ ...suggestion, cached: false });
});

// GET /api/wardrobe — read the wardrobe JSON from Drive, grouped by section.
wardrobeRouter.get('/', async (c) => {
  const accountId = c.get('session').sub;
  const fileId = await findFileId(c.env, accountId, WARDROBE_JSON);
  if (!fileId) return c.json({ error: 'wardrobe_json_not_found', detail: WARDROBE_JSON }, 404);

  const res = await googleFetch(c.env, accountId, `${DRIVE}/${fileId}?alt=media`);
  if (!res.ok) return c.json({ error: 'drive_error', detail: await res.text() }, 502);
  const json = await res.json();
  return c.json(normalize(json));
});

// POST /api/wardrobe/item — add a new item to the Drive JSON.
wardrobeRouter.post('/item', async (c) => {
  const accountId = c.get('session').sub;
  const body = await c.req.json<{ section: WardrobeSection; nazwa: string; nazwaPlikuDrive?: string }>();
  if (!SECTIONS.includes(body.section)) return c.json({ error: 'invalid_section' }, 400);
  if (!body.nazwa?.trim()) return c.json({ error: 'nazwa_required' }, 400);

  const fetched = await fetchRawJson(c.env, accountId);
  if (!fetched) return c.json({ error: 'wardrobe_json_not_found' }, 404);
  const { fileId, raw } = fetched;

  const items = getRawSection(raw, body.section);
  const newItem: Record<string, unknown> = {
    id: `${body.section.charAt(0).toUpperCase()}${Date.now()}`,
    nazwa: body.nazwa.trim(),
  };
  if (body.nazwaPlikuDrive) newItem['nazwaPlikuDrive'] = body.nazwaPlikuDrive;
  items.push(newItem);
  setRawSection(raw, body.section, items);

  const ok = await writeRawJson(c.env, accountId, fileId, raw);
  if (!ok) return c.json({ error: 'drive_write_error' }, 502);

  return c.json(normalize(raw), 201);
});

// PUT /api/wardrobe/item/:section/:index — update item's nazwa.
wardrobeRouter.put('/item/:section/:index', async (c) => {
  const section = c.req.param('section') as WardrobeSection;
  const idx = parseInt(c.req.param('index'), 10);
  if (!SECTIONS.includes(section) || isNaN(idx)) return c.json({ error: 'invalid_params' }, 400);

  const accountId = c.get('session').sub;
  const body = await c.req.json<{ nazwa?: string }>();

  const fetched = await fetchRawJson(c.env, accountId);
  if (!fetched) return c.json({ error: 'wardrobe_json_not_found' }, 404);
  const { fileId, raw } = fetched;

  const items = getRawSection(raw, section);
  if (idx < 0 || idx >= items.length) return c.json({ error: 'item_not_found' }, 404);
  if (body.nazwa?.trim()) items[idx].nazwa = body.nazwa.trim();
  setRawSection(raw, section, items);

  const ok = await writeRawJson(c.env, accountId, fileId, raw);
  if (!ok) return c.json({ error: 'drive_write_error' }, 502);

  return c.json(normalize(raw));
});

// DELETE /api/wardrobe/item/:section/:index — remove an item from the Drive JSON.
wardrobeRouter.delete('/item/:section/:index', async (c) => {
  const section = c.req.param('section') as WardrobeSection;
  const idx = parseInt(c.req.param('index'), 10);
  if (!SECTIONS.includes(section) || isNaN(idx)) return c.json({ error: 'invalid_params' }, 400);

  const accountId = c.get('session').sub;

  const fetched = await fetchRawJson(c.env, accountId);
  if (!fetched) return c.json({ error: 'wardrobe_json_not_found' }, 404);
  const { fileId, raw } = fetched;

  const items = getRawSection(raw, section);
  if (idx < 0 || idx >= items.length) return c.json({ error: 'item_not_found' }, 404);
  items.splice(idx, 1);
  setRawSection(raw, section, items);

  const ok = await writeRawJson(c.env, accountId, fileId, raw);
  if (!ok) return c.json({ error: 'drive_write_error' }, 502);

  return c.json(normalize(raw));
});
