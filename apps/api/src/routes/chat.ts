import { Hono } from 'hono';
import type { AppContext, Env } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';
import { googleFetch } from '../lib/google';
import { geminiGenerate } from '../lib/gemini';

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const CAL_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTasks(env: Env, accountId: string): Promise<any[]> {
  const url = `${TASKS_API}/lists/@default/tasks?showCompleted=false&maxResults=100`;
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
    `&singleEvents=true&orderBy=startTime&maxResults=50`;
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
    .limit(20);
  return (data ?? []).map((i) => ({ id: i.id, text: i.text, capturedAt: i.captured_at }));
}

async function executeTool(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: Record<string, any>,
  env: Env,
  accountId: string,
  supabase: SupabaseClient,
  today: string,
): Promise<string> {
  try {
    if (name === 'add_inbox_item') {
      const text = String(args.text ?? '').trim();
      if (!text) return 'Błąd: brak tekstu.';
      const { error } = await supabase
        .from('inbox_items')
        .insert({ text, source: 'web', status: 'new' });
      if (error) return `Błąd bazy: ${error.message}`;
      return `Dodano do inboxa: "${text}"`;
    }

    if (name === 'create_calendar_event') {
      const summary = String(args.summary ?? '').trim();
      const start = String(args.start ?? '').trim();
      const end = String(args.end ?? '').trim();
      if (!summary || !start || !end) return 'Błąd: brak wymaganych pól (summary, start, end).';
      const allDay = start.length === 10;
      const times = allDay
        ? { start: { date: start }, end: { date: end } }
        : { start: { dateTime: start }, end: { dateTime: end } };
      const res = await googleFetch(env, accountId, CAL_API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ summary, description: args.description ?? '', ...times }),
      });
      if (!res.ok) return `Błąd Google Calendar: ${await res.text()}`;
      return `Dodano wydarzenie: "${summary}" (${start})`;
    }

    if (name === 'check_habit') {
      const habitName = String(args.habit_name ?? '').trim().toLowerCase();
      const { data: habits } = await supabase.from('habits').select('id, name').eq('active', true);
      const habit = (habits ?? []).find((h) =>
        (h.name as string).toLowerCase().includes(habitName),
      );
      if (!habit) return `Nie znaleziono nawyku pasującego do: "${habitName}"`;
      const { error } = await supabase
        .from('habit_checks')
        .upsert({ habit_id: habit.id, date: today }, { onConflict: 'habit_id,date' });
      if (error) return `Błąd bazy: ${error.message}`;
      return `Zaznaczono nawyk "${habit.name}" jako wykonany dziś.`;
    }

    if (name === 'create_task') {
      const title = String(args.title ?? '').trim();
      const listId = String(args.list_id ?? '@default').trim() || '@default';
      if (!title) return 'Błąd: brak tytułu zadania.';
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
      if (!res.ok) return `Błąd Google Tasks: ${await res.text()}`;
      return `Utworzono zadanie: "${title}"`;
    }

    return `Nieznana akcja: ${name}`;
  } catch (err) {
    return `Błąd wykonania: ${String(err)}`;
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

// POST /api/chat — conversational AI with access to live app context + action tools.
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

  const [tasks, taskLists, events, habits, inbox] = await Promise.all([
    fetchTasks(c.env, accountId),
    fetchTaskLists(c.env, accountId),
    fetchEvents(c.env, accountId),
    fetchHabits(supabase, today),
    fetchInbox(supabase),
  ]);

  const systemPrompt = `Jesteś osobistym asystentem w aplikacji Life.OS. Rozmawiasz po polsku.
Masz dostęp do danych użytkownika w czasie rzeczywistym i możesz wykonywać akcje w jego imieniu.

AKTUALNY KONTEKST (${warsawTime(now)}):

ZADANIA (${tasks.length}):
${tasks.length ? tasks.map((t) => `- ${t.title}${t.due ? ` (termin: ${t.due.slice(0, 10)})` : ''}${t.notes ? ` | ${t.notes}` : ''}`).join('\n') : 'Brak aktywnych zadań.'}

LISTY ZADAŃ (do tworzenia zadań):
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

  // Build Gemini content from conversation history
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

  // Agentic loop: execute tool calls until Gemini returns a text response (max 5 rounds).
  for (let round = 0; round < 5; round++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const funcCallPart = candidate?.parts?.find((p: any) => p.functionCall);
    if (!funcCallPart) break;

    const { name, args } = funcCallPart.functionCall as {
      name: string;
      args: Record<string, unknown>;
    };
    const result = await executeTool(name, args ?? {}, c.env, accountId, supabase, today);
    actionsTaken.push(result);

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

    geminiData = (await geminiRes.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    candidate = geminiData?.candidates?.[0]?.content;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const replyText: string = candidate?.parts?.find((p: any) => p.text)?.text ?? '';

  return c.json({ reply: replyText, actions_taken: actionsTaken });
});
