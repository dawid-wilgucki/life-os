import { Hono } from 'hono';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';

export const profileRouter = new Hono<AppContext>();
profileRouter.use('*', requireAuth);

// GET /api/profile
profileRouter.get('/', async (c) => {
  const supabase = createSupabase(c.env);
  const { data, error } = await supabase
    .from('life_profile')
    .select('sections, updated_at')
    .eq('id', 1)
    .single();
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json({ sections: data?.sections ?? {}, updated_at: data?.updated_at ?? null });
});

// PATCH /api/profile — merge partial sections into the existing JSONB (never replaces all).
profileRouter.patch('/', async (c) => {
  const body = await c.req.json<{ sections: Record<string, string> }>();
  if (!body.sections || typeof body.sections !== 'object') {
    return c.json({ error: 'sections_required' }, 400);
  }

  const supabase = createSupabase(c.env);

  // Use raw SQL via rpc so we can use the || (jsonb merge) operator.
  // supabase-js doesn't support column || $1 in .update(), so we call a stored procedure
  // or use the REST /rpc endpoint. Simplest approach: fetch → merge → update.
  const { data: current, error: fetchErr } = await supabase
    .from('life_profile')
    .select('sections')
    .eq('id', 1)
    .single();

  if (fetchErr) return c.json({ error: 'db_error', detail: fetchErr.message }, 500);

  const merged = { ...(current?.sections ?? {}), ...body.sections };

  const { data, error } = await supabase
    .from('life_profile')
    .update({ sections: merged, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('sections, updated_at')
    .single();

  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json({ sections: data.sections, updated_at: data.updated_at });
});

// DELETE /api/profile/section/:key — remove a single key from the JSONB.
profileRouter.delete('/section/:key', async (c) => {
  const key = c.req.param('key');
  const supabase = createSupabase(c.env);

  const { data: current, error: fetchErr } = await supabase
    .from('life_profile')
    .select('sections')
    .eq('id', 1)
    .single();

  if (fetchErr) return c.json({ error: 'db_error', detail: fetchErr.message }, 500);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sections: Record<string, any> = { ...(current?.sections ?? {}) };
  delete sections[key];

  const { error } = await supabase
    .from('life_profile')
    .update({ sections, updated_at: new Date().toISOString() })
    .eq('id', 1);

  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json({ ok: true });
});
