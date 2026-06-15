-- Google Keep-style pinned lists (shopping list, notes, etc.)
CREATE TABLE lists (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text        NOT NULL,
  pinned     boolean     DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE list_items (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    uuid        NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  text       text        NOT NULL,
  checked    boolean     DEFAULT false,
  sort_order integer     DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Seed the default shopping list
INSERT INTO lists (title, pinned) VALUES ('Lista zakupów', true);

ALTER TABLE lists      ENABLE ROW LEVEL SECURITY;
ALTER TABLE list_items ENABLE ROW LEVEL SECURITY;
