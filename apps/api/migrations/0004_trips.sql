-- 0004: trips — travel log (manual entry or parsed from Gmail).
-- from/to are reserved-ish words, stored as from_loc/to_loc.

create table if not exists public.trips (
  id            uuid primary key default gen_random_uuid(),
  from_loc      text not null,
  to_loc        text not null,
  departure_at  timestamptz not null,
  arrival_at    timestamptz,
  carrier       text,
  train_number  text,
  seat          text,
  source        text not null default 'manual'
                  check (source in ('manual', 'gmail')),
  raw_email_id  text,
  created_at    timestamptz not null default now()
);

create index if not exists trips_departure_idx on public.trips (departure_at desc);

alter table public.trips enable row level security;
