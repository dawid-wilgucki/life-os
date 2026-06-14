-- 0006: habits — habit definitions.

create table if not exists public.habits (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  icon        text not null default '✅',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.habits enable row level security;
