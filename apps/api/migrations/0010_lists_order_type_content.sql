-- Add ordering, type (list|note), and free-text content to lists table.
ALTER TABLE lists ADD COLUMN IF NOT EXISTS order_index integer NOT NULL DEFAULT 0;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'list' CHECK (type IN ('list', 'note'));
ALTER TABLE lists ADD COLUMN IF NOT EXISTS content text;

-- Create an index so ordering queries stay fast.
CREATE INDEX IF NOT EXISTS lists_order_index_idx ON lists (order_index ASC, created_at ASC);
