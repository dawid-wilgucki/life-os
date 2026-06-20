import { Hono } from 'hono';
import type { AppContext, Env } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';
import { googleFetch } from '../lib/google';
import { geminiGenerate } from '../lib/gemini';

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const CAL_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

type SupabaseClient = ReturnType<typeof createSupabase>;

export const dayPlanRouter = new Hono<AppContext>();
dayPlanRouter.use('*', requireAuth);

const SYSTEM_PROMPT = `Jesteś osobistym asystentem produktywności w aplikacji Life.OS. Twoim zadaniem jest
stworzenie optymalnego planu dnia na podstawie dostarczonych danych.

TWOJE ZADANIE:
Przeanalizuj wszystkie dostarczone dane i wygeneruj posortowaną listę rzeczy do zrobienia
na dziś — zadania i nawyki razem, w jednej kolejności, gotowe do wykonania bez zastanawiania się.

ZASADY UKŁADANIA KOLEJNOŚCI:
1. Najpierw rzeczy czasowo zablokowane (przed wydarzeniem w kalendarzu)
2. Krótkie zadania (<15 min) grupuj razem żeby budować momentum
3. Nawyki wplataj między zadania, nie na końcu
4. Zadania wymagające skupienia umieszczaj wcześniej w dniu
5. Na końcu rzeczy bez deadlinu i niski priorytet

PROAKTYWNA ANALIZA KALENDARZA (WAŻNE):
Dla każdego wydarzenia w kalendarzu sprawdź czy użytkownik jest przygotowany:
- Podróż / wyjazd → czy ma bilet, rezerwację, spakowane rzeczy?
- Spotkanie / wizyta → czy jest coś do przygotowania wcześniej?
- Jeśli brakuje zadania które powinno istnieć → dodaj jako alert z type "warning"

KONTEKST KTÓRY OTRZYMASZ (w user message jako JSON):
{
  "current_time": "HH:MM",
  "tasks": [{ "title": "", "notes": "", "due": "" }],
  "calendar_events": [{ "summary": "", "start": "", "end": "", "description": "" }],
  "habits": [{ "name": "", "icon": "", "checked_today": true/false }]
}

WYMOGI TECHNICZNE (CRITICAL):
Zwróć WYŁĄCZNIE czysty JSON. Bez Markdown, bez wstępów. Pierwszym znakiem musi być "{".

Użyj DOKŁADNIE tej struktury:
{
  "generated_at": "HH:MM",
  "summary": "Jedno zdanie — co dziś najważniejsze",
  "alerts": [
    { "type": "warning", "message": "Opis rzeczy której brakuje lub wymaga sprawdzenia" }
  ],
  "plan": [
    {
      "order": 1,
      "type": "task|habit|alert",
      "title": "Nazwa",
      "duration_min": 15,
      "reason": "Krótko dlaczego teraz",
      "source": "google_tasks|habit_tracker|ai_generated"
    }
  ]
}`;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** HH:MM in Europe/Warsaw. */
function warsawHhmm(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

// Open Google Tasks from the default list (best-effort; [] on failure).
async function fetchTasks(
  env: Env,
  accountId: string,
): Promise<{ title: string; notes: string; due: string }[]> {
  const url = `${TASKS_API}/lists/@default/tasks?showCompleted=false&maxResults=100`;
  const res = await googleFetch(env, accountId, url);
  if (!res.ok) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as { items?: any[] };
  return (data.items ?? [])
    .filter((t) => t.status !== 'completed')
    .map((t) => ({ title: t.title ?? '', notes: t.notes ?? '', due: t.due ?? '' }));
}

// Calendar events from now to +3 days (best-effort; [] on failure).
async function fetchEvents(
  env: Env,
  accountId: string,
  timeMin: string,
  timeMax: string,
): Promise<{ summary: string; start: string; end: string; description: string }[]> {
  const url =
    `${CAL_API}?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
    `&singleEvents=true&orderBy=startTime&maxResults=50`;
  const res = await googleFetch(env, accountId, url);
  if (!res.ok) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as { items?: any[] };
  return (data.items ?? []).map((g) => ({
    summary: g.summary ?? '',
    start: g.start?.dateTime ?? g.start?.date ?? '',
    end: g.end?.dateTime ?? g.end?.date ?? '',
    description: g.description ?? '',
  }));
}

// Active habits with whether they were checked today.
async function fetchHabits(
  supabase: SupabaseClient,
  today: string,
): Promise<{ name: string; icon: string; checked_today: boolean }[]> {
  const { data: habits } = await supabase
    .from('habits')
    .select('id, name, icon')
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (!habits?.length) return [];

  const { data: checks } = await supabase
    .from('habit_checks')
    .select('habit_id')
    .eq('date', today);
  const checkedIds = new Set((checks ?? []).map((ch) => ch.habit_id as string));

  return habits.map((h) => ({
    name: h.name as string,
    icon: h.icon as string,
    checked_today: checkedIds.has(h.id as string),
  }));
}

// GET /api/day-plan — AI-ordered to-do list for today (tasks + habits + alerts).
// Cached in KV per day for 1h; ?refresh=true regenerates.
dayPlanRouter.get('/', async (c) => {
  const accountId = c.get('session').sub;
  const now = new Date();
  const today = ymd(now);
  const cacheKey = `day-plan:${today}`;
  const refresh = c.req.query('refresh') === 'true';

  if (!refresh) {
    const cached = await c.env.TOKENS.get(cacheKey);
    if (cached) return c.json({ ...JSON.parse(cached), cached: true });
  }

  if (!c.env.GEMINI_API_KEY) return c.json({ error: 'gemini_not_configured' }, 503);

  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 3 * 24 * 3600 * 1000).toISOString();
  const supabase = createSupabase(c.env);

  const [tasks, calendar_events, habits] = await Promise.all([
    fetchTasks(c.env, accountId),
    fetchEvents(c.env, accountId, timeMin, timeMax),
    fetchHabits(supabase, today),
  ]);

  const userPayload = {
    current_time: warsawHhmm(now),
    tasks,
    calendar_events,
    habits,
  };

  const geminiRes = await geminiGenerate(c.env, {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts: [{ text: JSON.stringify(userPayload) }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.6 },
  });
  if (!geminiRes.ok) {
    const detail = await geminiRes.text();
    console.error('Gemini day-plan error:', geminiRes.status, detail);
    return c.json({ error: 'gemini_error', status: geminiRes.status, detail }, 502);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geminiData = (await geminiRes.json()) as any;
  const rawText: string = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let plan: Record<string, any>;
  try {
    plan = JSON.parse(rawText.trim());
    if (!Array.isArray(plan.plan)) throw new Error('invalid shape');
  } catch {
    return c.json({ error: 'gemini_parse_error', raw: rawText.slice(0, 300) }, 502);
  }

  await c.env.TOKENS.put(cacheKey, JSON.stringify(plan), { expirationTtl: 3600 });
  return c.json({ ...plan, cached: false });
});
