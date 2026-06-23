import { Hono } from 'hono';
import type { AppContext, Env } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';
import { googleFetch } from '../lib/google';
import { geminiGenerate } from '../lib/gemini';

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const CAL_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
/** Context is cached in KV for this many seconds to avoid redundant API calls. */
const CTX_TTL = 120;

type SupabaseClient = ReturnType<typeof createSupabase>;

export const chatRouter = new Hono<AppContext>();
chatRouter.use('*', requireAuth);

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function warsawTime(d: Date): string {
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: 'Europe/Warsaw',
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(d);
}

interface ChatContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tasks: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  taskLists: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  habits: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inbox: any[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTasks(env: Env, accountId: string): Promise<any[]> {
  const url = `${TASKS_API}/lists/@default/tasks?showCompleted=false&maxResults=50`;
  const res = await googleFetch(env, accountId, url);
  if (!res.ok) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as { items?: any[] };
  return (data.items ?? [])
    .filter((t) => t.status !== 'completed')
    .map((t) => ({ id: t.id ?? '', title: t.title ?? '', notes: t.notes ?? '', due: t.due ?? '' }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTaskLists(env: Env, accountId: string): Promise<any[]> {
  const res = await googleFetch(env, accountId, `${TASKS_API}/users/@me/lists?maxResults=20`);
  if (!res.ok) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as { items?: any[] };
  return (data.items ?? []).map((l) => ({ id: l.id ?? '', title: l.title ?? '' }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchEvents(env: Env, accountId: string): Promise<any[]> {
  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
  const url =
    `${CAL_API}?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
    `&singleEvents=true&orderBy=startTime&maxResults=30`;
  const res = await googleFetch(env, accountId, url);
  if (!res.ok) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as { items?: any[] };
  return (data.items ?? []).map((g) => ({
    id: g.id ?? '',
    summary: g.summary ?? '',
    start: g.start?.dateTime ?? g.start?.date ?? '',
    end: g.end?.dateTime ?? g.end?.date ?? '',
    description: g.description ?? '',
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchHabits(supabase: SupabaseClient, today: string): Promise<any[]> {
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
    id: h.id as string,
    name: h.name as string,
    icon: h.icon as string,
    checked_today: checkedIds.has(h.id as string),
  }));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchInbox(supabase: SupabaseClient): Promise<any[]> {
  const { data } = await supabase
    .from('inbox_items')
    .select('id, text, captured_at')
    .eq('status', 'new')
    .order('captured_at', { ascending: false })
    .limit(15);
  return (data ?? []).map((i) => ({ id: i.id, text: i.text, capturedAt: i.captured_at }));
}

async function loadContext(
  env: Env,
  accountId: string,
  today: string,
  supabase: SupabaseClient,
): Promise<ChatContext> {
  const cacheKey = `chat-ctx:${accountId}:${today}`;
  const cached = await env.TOKENS.get(cacheKey);
  if (cached) return JSON.parse(cached) as ChatContext;

  const [tasks, taskLists, events, habits, inbox] = await Promise.all([
    fetchTasks(env, accountId),
    fetchTaskLists(env, accountId),
    fetchEvents(env, accountId),
    fetchHabits(supabase, today),
    fetchInbox(supabase),
  ]);

  const ctx: ChatContext = { tasks, taskLists, events, habits, inbox };
  await env.TOKENS.put(cacheKey, JSON.stringify(ctx), { expirationTtl: CTX_TTL });
  return ctx;
}

/** Call after any mutating tool to force a fresh context fetch on the next message. */
async function invalidateContext(env: Env, accountId: string, today: string): Promise<void> {
  await env.TOKENS.delete(`chat-ctx:${accountId}:${today}`);
}

/** Returns the tool result string. `mutated` true means app data changed. */
async function executeTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>,
  env: Env,
  accountId: string,
  supabase: SupabaseClient,
  today: string,
): Promise<{ result: string; mutated: boolean }> {
  try {
    if (name === 'add_inbox_item') {
      const text = String(args.text ?? '').trim();
      if (!text) return { result: 'Błąd: brak tekstu.', mutated: false };
      const { error } = await supabase
        .from('inbox_items')
        .insert({ text, source: 'web', status: 'new' });
      if (error) return { result: `Błąd bazy: ${error.message}`, mutated: false };
      return { result: `Dodano do inboxa: "${text}"`, mutated: true };
    }

    if (name === 'create_calendar_event') {
      const summary = String(args.summary ?? '').trim();
      const start = String(args.start ?? '').trim();
      const end = String(args.end ?? '').trim();
      if (!summary || !start || !end)
        return { result: 'Błąd: brak wymaganych pól (summary, start, end).', mutated: false };
      const allDay = start.length === 10;
      const times = allDay
        ? { start: { date: start }, end: { date: end } }
        : { start: { dateTime: start }, end: { dateTime: end } };
      const res = await googleFetch(env, accountId, CAL_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ summary, description: args.description ?? '', ...times }),
      });
      if (!res.ok)
        return { result: `Błąd Google Calendar: ${await res.text()}`, mutated: false };
      return { result: `Dodano wydarzenie: "${summary}" (${start})`, mutated: true };
    }

    if (name === 'check_habit') {
      const habitName = String(args.habit_name ?? '').trim().toLowerCase();
      const { data: habits } = await supabase
        .from('habits')
        .select('id, name')
        .eq('active', true);
      const habit = (habits ?? []).find((h) =>
        (h.name as string).toLowerCase().includes(habitName),
      );
      if (!habit)
        return {
          result: `Nie znaleziono nawyku pasującego do: "${habitName}"`,
          mutated: false,
        };
      const { error } = await supabase
        .from('habit_checks')
        .upsert({ habit_id: habit.id, date: today }, { onConflict: 'habit_id,date' });
      if (error) return { result: `Błąd bazy: ${error.message}`, mutated: false };
      return { result: `Zaznaczono nawyk "${habit.name}" jako wykonany dziś.`, mutated: true };
    }

    if (name === 'create_task') {
      const title = String(args.title ?? '').trim();
      const listId = String(args.list_id ?? '@default').trim() || '@default';
      if (!title) return { result: 'Błąd: brak tytułu zadania.', mutated: false };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const taskBody: Record<string, any> = { title };
      if (args.due) taskBody.due = String(args.due);
      if (args.notes) taskBody.notes = String(args.notes);
      const res = await googleFetch(
        env,
        accountId,
        `${TASKS_API}/lists/${encodeURIComponent(listId)}/tasks`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(taskBody),
        },
      );
      if (!res.ok) return { result: `Błąd Google Tasks: ${await res.text()}`, mutated: false };
      return { result: `Utworzono zadanie: "${title}"`, mutated: true };
    }

    return { result: `Nieznana akcja: ${name}`, mutated: false };
  } catch (err) {
    return { result: `Błąd wykonania: ${String(err)}`, mutated: false };
  }
}

const TOOLS = [
  {
    function_declarations: [
      {
        name: 'add_inbox_item',
        description: 'Dodaje nową notatkę lub myśl do GTD inboxa użytkownika.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Treść noty do dodania do inboxa.' },
          },
          required: ['text'],
        },
      },
      {
        name: 'create_calendar_event',
        description: 'Tworzy nowe wydarzenie w Google Calendar użytkownika.',
        parameters: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'Tytuł (nazwa) wydarzenia.' },
            start: {
              type: 'string',
              description:
                'Czas rozpoczęcia. Format: YYYY-MM-DDTHH:MM:SS dla wydarzeń z godziną, YYYY-MM-DD dla całodniowych.',
            },
            end: {
              type: 'string',
              description:
                'Czas zakończenia. Ten sam format co start. Dla całodniowych podaj dzień następny.',
            },
            description: {
              type: 'string',
              description: 'Opcjonalny opis lub notatki do wydarzenia.',
            },
          },
          required: ['summary', 'start', 'end'],
        },
      },
      {
        name: 'check_habit',
        description: 'Zaznacza nawyk jako wykonany na dzisiaj.',
        parameters: {
          type: 'object',
          properties: {
            habit_name: {
              type: 'string',
              description: 'Nazwa nawyku (lub jej część) do zaznaczenia jako wykonany.',
            },
          },
          required: ['habit_name'],
        },
      },
      {
        name: 'create_task',
        description: 'Tworzy nowe zadanie w Google Tasks.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Tytuł zadania.' },
            list_id: {
              type: 'string',
              description:
                'ID listy zadań. Użyj "@default" dla domyślnej listy lub podaj ID z dostępnych list w kontekście.',
            },
            due: {
              type: 'string',
              description:
                'Opcjonalna data wykonania w formacie RFC3339, np. 2026-06-25T00:00:00.000Z.',
            },
            notes: { type: 'string', description: 'Opcjonalne notatki do zadania.' },
          },
          required: ['title', 'list_id'],
        },
      },
    ],
  },
];

// POST /api/chat — conversational AI with live context (KV-cached 2 min) + action tools.
chatRouter.post('/', async (c) => {
  if (!c.env.GEMINI_API_KEY) return c.json({ error: 'gemini_not_configured' }, 503);

  const accountId = c.get('session').sub;

  const body = await c.req.json<{
    messages: Array<{ role: 'user' | 'model'; text: string }>;
  }>();
  if (!body.messages?.length) return c.json({ error: 'messages_required' }, 400);

  const lastMessage = body.messages[body.messages.length - 1];
  if (lastMessage.role !== 'user') return c.json({ error: 'last_message_must_be_user' }, 400);

  const now = new Date();
  const today = ymd(now);
  const supabase = createSupabase(c.env);

  // Load context from KV cache (or fetch fresh if expired/missing).
  const { tasks, taskLists, events, habits, inbox } = await loadContext(
    c.env,
    accountId,
    today,
    supabase,
  );

  const systemPrompt = `Jesteś osobistym asystentem w aplikacji Life.OS. Rozmawiasz po polsku.
Masz dostęp do danych użytkownika i możesz wykonywać akcje w jego imieniu.

AKTUALNY KONTEKST (${warsawTime(now)}):

ZADANIA (${tasks.length}):
${tasks.length ? tasks.map((t) => `- ${t.title}${t.due ? ` (termin: ${t.due.slice(0, 10)})` : ''}${t.notes ? ` | ${t.notes}` : ''}`).join('\n') : 'Brak aktywnych zadań.'}

LISTY ZADAŃ:
${taskLists.length ? taskLists.map((l) => `- "${l.title}" → id: ${l.id}`).join('\n') : 'Brak list.'}

WYDARZENIA KALENDARZOWE — najbliższe 7 dni (${events.length}):
${events.length ? events.map((e) => `- ${e.summary} | ${e.start}${e.description ? ` | ${e.description}` : ''}`).join('\n') : 'Brak nadchodzących wydarzeń.'}

NAWYKI — dzisiaj (${habits.length}):
${habits.length ? habits.map((h) => `- ${h.icon} ${h.name}: ${h.checked_today ? '✅ wykonany' : '⬜ do zrobienia'}`).join('\n') : 'Brak aktywnych nawyków.'}

INBOX — nowe notatki (${inbox.length}):
${inbox.length ? inbox.map((i) => `- ${i.text}`).join('\n') : 'Inbox pusty.'}

ZASADY:
- Odpowiadaj krótko i konkretnie po polsku.
- Jeśli użytkownik prosi o dodanie czegoś — użyj odpowiedniego narzędzia.
- Daty eventów: YYYY-MM-DDTHH:MM:SS dla z godziną, YYYY-MM-DD dla całodniowych.
- Nie wymyślaj danych — bazuj wyłącznie na kontekście powyżej.
- Po wykonaniu akcji potwierdź co zostało zrobione.`;

  let currentContents = body.messages.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));

  let geminiRes = await geminiGenerate(c.env, {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: currentContents,
    tools: TOOLS,
    generationConfig: { temperature: 0.7 },
  });

  if (!geminiRes.ok) {
    const detail = await geminiRes.text();
    console.error('Gemini chat error:', geminiRes.status, detail);
    return c.json({ error: 'gemini_error', detail }, 502);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let geminiData = (await geminiRes.json()) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let candidate: any = geminiData?.candidates?.[0]?.content;

  const actionsTaken: string[] = [];
  let contextDirty = false;

  // Agentic loop: execute tool calls until Gemini returns a text response (max 5 rounds).
  for (let round = 0; round < 5; round++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const funcCallPart = candidate?.parts?.find((p: any) => p.functionCall);
    if (!funcCallPart) break;

    const { name, args } = funcCallPart.functionCall as {
      name: string;
      args: Record<string, unknown>;
    };
    const { result, mutated } = await executeTool(
      name,
      args ?? {},
      c.env,
      accountId,
      supabase,
      today,
    );
    actionsTaken.push(result);
    if (mutated) contextDirty = true;

    currentContents = [
      ...currentContents,
      { role: 'model', parts: candidate.parts },
      { role: 'user', parts: [{ functionResponse: { name, response: { result } } }] },
    ];

    geminiRes = await geminiGenerate(c.env, {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: currentContents,
      tools: TOOLS,
      generationConfig: { temperature: 0.7 },
    });

    if (!geminiRes.ok) {
      const detail = await geminiRes.text();
      console.error('Gemini chat tool-loop error:', geminiRes.status, detail);
      return c.json({ error: 'gemini_error', detail }, 502);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    geminiData = (await geminiRes.json()) as any;
    candidate = geminiData?.candidates?.[0]?.content;
  }

  // Invalidate the context cache if any action mutated app data, so the next
  // message fetches fresh state (e.g., the just-added inbox item is visible).
  if (contextDirty) {
    await invalidateContext(c.env, accountId, today);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const replyText: string = candidate?.parts?.find((p: any) => p.text)?.text ?? '';

  return c.json({ reply: replyText, actions_taken: actionsTaken });
});
