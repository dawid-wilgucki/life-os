-- 0003: inbox_items — GTD capture (web input or Telegram /inbox).

create table if not exists public.inbox_items (
  id           uuid primary key default gen_random_uuid(),
  text         text not null,
  source       text not null default 'web'
                 check (source in ('web', 'telegram')),
  status       text not null default 'new'
                 check (status in ('new', 'archived', 'converted')),
  captured_at  timestamptz not null default now()
);

create index if not exists inbox_items_status_idx on public.inbox_items (status);

alter table public.inbox_items enable row level security;
