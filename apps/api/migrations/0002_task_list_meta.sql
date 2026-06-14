-- 0002: task_list_meta — UI extras for Google Task lists (color, pin, order),
-- keyed by the Google task-list id. Google remains source of truth for tasks.

create table if not exists public.task_list_meta (
  google_list_id  text primary key,
  color           text,
  pinned          boolean not null default false,
  sort_order      integer,
  created_at      timestamptz not null default now()
);

alter table public.task_list_meta enable row level security;
