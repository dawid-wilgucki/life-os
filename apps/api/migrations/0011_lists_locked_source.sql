-- Locked / synced lists.
-- `locked` marks a list that cannot be deleted (only its items can change).
-- `source` distinguishes local Keep-style lists from the one mirroring Google Tasks.
-- For source = 'google_tasks', the `content` column stores the Google task-list id.
ALTER TABLE lists ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'local'
  CHECK (source IN ('local', 'google_tasks'));

-- Guarantee at most one Google-Tasks-mirroring list (guards concurrent creation).
CREATE UNIQUE INDEX IF NOT EXISTS lists_one_google_tasks
  ON lists (source) WHERE source = 'google_tasks';
