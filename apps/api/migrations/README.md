# Supabase migrations

Plain SQL, applied in numeric order. RLS is enabled on every table with **no
policies**, so only the Worker's service-role key can read/write them.

## Apply

**Option A — Supabase SQL editor:** paste each file in order (0001 → 0016) and run.

**Option B — Supabase CLI:**

```bash
supabase db push           # if using the CLI migration workflow
# or apply directly:
psql "$SUPABASE_DB_URL" -f 0001_google_accounts.sql
# ...through 0016
```

## Notes

- `0001` also creates the shared `set_updated_at()` trigger function and the
  `pgcrypto` extension (for `gen_random_uuid()`).
- `google_accounts.tasks_sync_cursor` is a **timestamp**, not an opaque token —
  the Google Tasks API has no syncToken, so we page by `updatedMin`.
- `0015_shelly.sql` creates the Shelly tables and seeds the pump and the garden
  lights; `0016_shelly_functions.sql` adds the SQL aggregations the Worker calls
  via `supabase.rpc` (`shelly_energy_between`, `shelly_energy_series`,
  `shelly_activity_series`). Both are idempotent (safe to re-run).
