-- 0001: google_accounts — OAuth tokens + sync cursors for the single account.
-- access_token is NOT stored here; it lives in Worker KV (short TTL).

create extension if not exists pgcrypto;

-- Shared trigger to keep updated_at fresh.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.google_accounts (
  id                          uuid primary key default gen_random_uuid(),
  email                       text not null,
  refresh_token               text not null,
  token_expiry                timestamptz,
  scope                       text,
  -- Calendar uses an opaque incremental syncToken.
  calendar_sync_token         text,
  -- Google Tasks API has NO syncToken; we page by updatedMin instead, so this
  -- is a timestamp cursor rather than an opaque token (see ARCHITECTURE notes).
  tasks_sync_cursor           timestamptz,
  -- Optional Calendar push (events.watch) channel bookkeeping.
  calendar_watch_channel_id   text,
  calendar_watch_resource_id  text,
  calendar_watch_expiry       timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

drop trigger if exists trg_google_accounts_updated on public.google_accounts;
create trigger trg_google_accounts_updated
  before update on public.google_accounts
  for each row execute function public.set_updated_at();

-- RLS on, no policies: only the service-role key (the Worker) can touch it.
alter table public.google_accounts enable row level security;
