-- Life Profile: single-row JSONB store for the user's life context sections.
-- Each section is a free-form string; keys are user-defined (snake_case recommended).
CREATE TABLE IF NOT EXISTS life_profile (
  id          INTEGER PRIMARY KEY DEFAULT 1,
  sections    JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the single row with default section keys so the UI has something to show.
INSERT INTO life_profile (id, sections)
VALUES (1, '{
  "praca": "",
  "dom": "",
  "cele": "",
  "zdrowie": "",
  "relacje": "",
  "finanse": "",
  "projekty": "",
  "inne": ""
}')
ON CONFLICT (id) DO NOTHING;
