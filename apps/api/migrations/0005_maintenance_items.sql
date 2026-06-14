-- 0005: maintenance_items — recurring home/garden/car tasks with next due date.

create table if not exists public.maintenance_items (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  category         text not null
                     check (category in ('ogrod', 'dom', 'auto')),
  next_due         date not null,
  interval_days    integer not null check (interval_days > 0),
  -- Optional mirror into the "Dom/Konserwacja" Google Calendar.
  google_event_id  text,
  -- Reset to false each time next_due advances; set true when reminder fires.
  reminder_sent    boolean not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists maintenance_next_due_idx on public.maintenance_items (next_due);

alter table public.maintenance_items enable row level security;
