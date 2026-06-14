-- 0007: habit_checks — one row per habit per day it was completed.
-- Unique (habit_id, date) makes check-in idempotent; streaks derive from these.

create table if not exists public.habit_checks (
  id          uuid primary key default gen_random_uuid(),
  habit_id    uuid not null references public.habits (id) on delete cascade,
  date        date not null,
  created_at  timestamptz not null default now(),
  unique (habit_id, date)
);

create index if not exists habit_checks_habit_date_idx
  on public.habit_checks (habit_id, date desc);

alter table public.habit_checks enable row level security;
