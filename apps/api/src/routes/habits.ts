import { Hono } from 'hono';
import type { CreateHabitInput, HabitWithStreak } from '@life-os/shared-types';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';

export const habitsRouter = new Hono<AppContext>();
habitsRouter.use('*', requireAuth);

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function isNextDay(prev: string, next: string): boolean {
  const p = new Date(`${prev}T00:00:00Z`);
  p.setUTCDate(p.getUTCDate() + 1);
  return ymd(p) === next;
}

/** Day keys for Monday..Sunday of the current (UTC) week. */
function currentWeekKeys(): string[] {
  const now = new Date();
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return ymd(d);
  });
}

/** current (run ending today or yesterday), longest, and checkedToday. */
function computeStreaks(dates: string[]): {
  current: number;
  longest: number;
  checkedToday: boolean;
} {
  const set = new Set(dates);
  const todayStr = ymd(new Date());
  const checkedToday = set.has(todayStr);

  let current = 0;
  const cursor = new Date();
  if (!checkedToday) cursor.setUTCDate(cursor.getUTCDate() - 1); // grace until end of day
  while (set.has(ymd(cursor))) {
    current++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of [...set].sort()) {
    run = prev && isNextDay(prev, d) ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }

  return { current, longest, checkedToday };
}

// GET /api/habits — active habits enriched with streaks.
habitsRouter.get('/', async (c) => {
  const supabase = createSupabase(c.env);
  const { data: habits, error } = await supabase
    .from('habits')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);

  const { data: checks } = await supabase.from('habit_checks').select('habit_id, date');
  const byHabit = new Map<string, string[]>();
  for (const ch of checks ?? []) {
    const arr = byHabit.get(ch.habit_id as string) ?? [];
    arr.push(ch.date as string);
    byHabit.set(ch.habit_id as string, arr);
  }

  const weekKeys = currentWeekKeys();
  const result: HabitWithStreak[] = (habits ?? []).map((h) => {
    const dates = byHabit.get(h.id as string) ?? [];
    const s = computeStreaks(dates);
    const set = new Set(dates);
    return {
      id: h.id,
      name: h.name,
      icon: h.icon,
      active: h.active,
      createdAt: h.created_at,
      checkedToday: s.checkedToday,
      currentStreak: s.current,
      longestStreak: s.longest,
      weeklyChecks: weekKeys.map((k) => set.has(k)),
    };
  });
  return c.json(result);
});

// POST /api/habits
habitsRouter.post('/', async (c) => {
  const body = await c.req.json<CreateHabitInput>();
  if (!body.name?.trim()) return c.json({ error: 'name_required' }, 400);
  const supabase = createSupabase(c.env);
  const { data, error } = await supabase
    .from('habits')
    .insert({ name: body.name.trim(), icon: body.icon || '✅', active: true })
    .select('*')
    .single();
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json(
    {
      id: data.id,
      name: data.name,
      icon: data.icon,
      active: data.active,
      createdAt: data.created_at,
      checkedToday: false,
      currentStreak: 0,
      longestStreak: 0,
      weeklyChecks: [false, false, false, false, false, false, false],
    } satisfies HabitWithStreak,
    201,
  );
});

// DELETE /api/habits/:id — remove a habit (its checks cascade-delete).
habitsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabase(c.env);
  const { error } = await supabase.from('habits').delete().eq('id', id);
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.body(null, 204);
});

// POST /api/habits/:id/check — idempotent check-in for today.
habitsRouter.post('/:id/check', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabase(c.env);
  const { error } = await supabase
    .from('habit_checks')
    .upsert({ habit_id: id, date: ymd(new Date()) }, { onConflict: 'habit_id,date', ignoreDuplicates: true });
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json({ ok: true });
});

// DELETE /api/habits/:id/check — undo today's check-in.
habitsRouter.delete('/:id/check', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabase(c.env);
  const { error } = await supabase
    .from('habit_checks')
    .delete()
    .eq('habit_id', id)
    .eq('date', ymd(new Date()));
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.body(null, 204);
});
