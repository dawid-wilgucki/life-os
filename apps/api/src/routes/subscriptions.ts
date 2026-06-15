import { Hono } from 'hono';
import type { Subscription, CreateSubscriptionInput } from '@life-os/shared-types';
import type { AppContext } from '../types';
import { requireAuth } from '../middleware/auth';
import { createSupabase } from '../lib/supabase';

export const subscriptionsRouter = new Hono<AppContext>();
subscriptionsRouter.use('*', requireAuth);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSub(row: any): Subscription {
  return {
    id: row.id,
    name: row.name,
    costPln: Number(row.cost_pln),
    billingCycle: row.billing_cycle,
    renewalDate: row.renewal_date ?? undefined,
    color: row.color ?? undefined,
    icon: row.icon ?? undefined,
    createdAt: row.created_at,
  };
}

// GET /api/subscriptions
subscriptionsRouter.get('/', async (c) => {
  const supabase = createSupabase(c.env);
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json((data ?? []).map(toSub));
});

// POST /api/subscriptions
subscriptionsRouter.post('/', async (c) => {
  const body = await c.req.json<CreateSubscriptionInput>();
  if (!body.name?.trim()) return c.json({ error: 'name_required' }, 400);
  const supabase = createSupabase(c.env);
  const { data, error } = await supabase
    .from('subscriptions')
    .insert({
      name: body.name.trim(),
      cost_pln: body.costPln ?? 0,
      billing_cycle: body.billingCycle ?? 'monthly',
      renewal_date: body.renewalDate ?? null,
      color: body.color ?? null,
      icon: body.icon ?? null,
    })
    .select()
    .single();
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.json(toSub(data), 201);
});

// DELETE /api/subscriptions/:id
subscriptionsRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabase(c.env);
  const { error } = await supabase.from('subscriptions').delete().eq('id', id);
  if (error) return c.json({ error: 'db_error', detail: error.message }, 500);
  return c.body(null, 204);
});
