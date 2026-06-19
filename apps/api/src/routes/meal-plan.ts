import { Hono } from 'hono';
import type { MealPlan } from '@life-os/shared-types';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';

const GEMINI_MODEL = 'gemini-3.5-flash';

export const mealPlanRouter = new Hono<AppContext>();
mealPlanRouter.use('*', requireAuth);

const SYSTEM_PROMPT = `Jesteś wybitnym dietetykiem i szefem kuchni specjalizującym się w szybkich, zdrowych posiłkach oraz optymalizacji czasu w kuchni (batch cooking).

Twoim zadaniem jest wygenerowanie 7-dniowego jadłospisu obiadowego na podstawie przekazanej przez użytkownika listy zakupów lub zapasów. Wynik Twojej pracy trafi bezpośrednio do minimalistycznego widgetu na dashboardzie aplikacji Life.OS, dlatego musisz trzymać się rygorystycznych zasad formatowania i długości tekstów.

ZASADY TWORZENIA JADŁOSPISU:

Szybkość i zdrowie: Dania muszą być zbilansowane, odżywcze i wymagać maksymalnie 30 minut aktywnego gotowania.

Batch Cooking (Gotowanie na 2 dni): Maksymalnie wykorzystuj czas. Zaplanuj gotowanie większej porcji co drugi dzień (np. poniedziałek: gotowanie, wtorek: odgrzewana porcja z poniedziałku).

Różnorodność: Po dwóch dniach jedzenia tego samego posiłku, zaproponuj coś z zupełnie innej kategorii.

Zwięzłość (dla UI): Widget ma mało miejsca. Instrukcje przygotowania (recipe_steps) muszą być ultrakrótkie, zapisane w 3-4 żołnierskich krokach.

WYMOGI TECHNICZNE (CRITICAL):

Zwróć WYŁĄCZNIE czysty kod JSON. Nie używaj znaczników Markdown (np. \`\`\`json), żadnych wstępów, ani podsumowań. Pierwszym znakiem odpowiedzi musi być "{", a ostatnim "}".

Użyj dokładnie poniższej struktury schematu JSON, gdzie flaga 'is_batch_leftover' ma być ustawiana na true dla dań z poprzedniego dnia:
{"meal_plan": [{"day_id": 1, "day_name": "Poniedziałek", "meal_name": "Nazwa", "prep_time_min": 25, "is_batch_leftover": false, "tags": ["Zdrowe"], "recipe_steps": ["Krok 1", "Krok 2"]}]}`;

const KV_TTL = 7 * 24 * 3600; // 7 days

// GET /api/meal-plan — returns cached plan or generates a new one.
// Query: ?force=true to bypass cache and regenerate.
mealPlanRouter.get('/', async (c) => {
  const accountId = c.get('session').sub;
  const force = c.req.query('force') === 'true';
  const kvKey = `meal_plan:${accountId}`;

  if (!force) {
    const cached = await c.env.TOKENS.get(kvKey);
    if (cached) return c.json(JSON.parse(cached) as MealPlan);
  }

  if (!c.env.GEMINI_API_KEY) {
    return c.json({ error: 'gemini_not_configured' }, 503);
  }

  // Fetch the shopping list
  const supabase = createSupabase(c.env);
  const { data: listRow } = await supabase
    .from('lists')
    .select('*, list_items(*)')
    .ilike('title', '%zakup%')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: string[] = (listRow?.list_items as any[] ?? [])
    .filter((i) => !i.checked)
    .map((i) => i.text as string);

  const userPrompt = items.length > 0
    ? `Lista zakupów:\n${items.join('\n')}`
    : 'Brak listy zakupów. Zaproponuj 7-dniowy jadłospis oparty na typowych produktach dostępnych w Polsce.';

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${c.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.7,
        },
      }),
    },
  );

  if (!geminiRes.ok) {
    const detail = await geminiRes.text();
    console.error('Gemini error:', geminiRes.status, detail);
    return c.json({ error: 'gemini_error', status: geminiRes.status, detail }, 502);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geminiData = (await geminiRes.json()) as any;
  const rawText: string = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  let plan: MealPlan;
  try {
    const parsed = JSON.parse(rawText.trim());
    if (!Array.isArray(parsed?.meal_plan)) throw new Error('missing meal_plan array');
    plan = { meal_plan: parsed.meal_plan, generatedAt: new Date().toISOString() };
  } catch {
    return c.json({ error: 'gemini_parse_error', raw: rawText.slice(0, 300) }, 502);
  }

  await c.env.TOKENS.put(kvKey, JSON.stringify(plan), { expirationTtl: KV_TTL });
  return c.json(plan);
});

// DELETE /api/meal-plan — invalidate the cache (next GET will regenerate).
mealPlanRouter.delete('/', async (c) => {
  const accountId = c.get('session').sub;
  await c.env.TOKENS.delete(`meal_plan:${accountId}`);
  return c.body(null, 204);
});

const SHOPPING_LIST_PROMPT = `Jesteś asystentem kuchennym. Na podstawie podanego jadłospisu wygeneruj minimalną, deduplikowaną listę zakupów. Zwróć WYŁĄCZNIE czysty JSON. Pierwszym znakiem musi być "[", ostatnim "]". Format: ["składnik 1", "składnik 2", ...]`;

// POST /api/meal-plan/generate-shopping-list — extract ingredients and add to the shopping list.
mealPlanRouter.post('/generate-shopping-list', async (c) => {
  const accountId = c.get('session').sub;
  const kvKey = `meal_plan:${accountId}`;

  const cached = await c.env.TOKENS.get(kvKey);
  if (!cached) return c.json({ error: 'no_meal_plan' }, 404);

  if (!c.env.GEMINI_API_KEY) return c.json({ error: 'gemini_not_configured' }, 503);

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${c.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SHOPPING_LIST_PROMPT }] },
        contents: [{ parts: [{ text: cached }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.3,
        },
      }),
    },
  );
  if (!geminiRes.ok) return c.json({ error: 'gemini_error', detail: await geminiRes.text() }, 502);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geminiData = (await geminiRes.json()) as any;
  const rawText: string = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  let ingredients: string[];
  try {
    const parsed = JSON.parse(rawText.trim());
    if (!Array.isArray(parsed)) throw new Error('not an array');
    ingredients = parsed.filter((s): s is string => typeof s === 'string');
  } catch {
    return c.json({ error: 'gemini_parse_error', raw: rawText.slice(0, 300) }, 502);
  }

  const supabase = createSupabase(c.env);
  const { data: listRow } = await supabase
    .from('lists')
    .select('id, list_items(text, checked)')
    .ilike('title', '%zakup%')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!listRow) return c.json({ error: 'shopping_list_not_found' }, 404);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingTexts = new Set<string>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (listRow.list_items as any[])
      .filter((i) => !i.checked)
      .map((i) => (i.text as string).toLowerCase().trim()),
  );

  const toAdd = ingredients.filter((ing) => !existingTexts.has(ing.toLowerCase().trim()));

  if (toAdd.length > 0) {
    await supabase.from('list_items').insert(
      toAdd.map((text, i) => ({
        list_id: listRow.id,
        text,
        checked: false,
        sort_order: Date.now() + i,
      })),
    );
  }

  return c.json({ added: toAdd.length, skipped: ingredients.length - toAdd.length });
});
