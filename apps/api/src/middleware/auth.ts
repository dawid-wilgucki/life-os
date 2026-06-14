import { createMiddleware } from 'hono/factory';
import type { AppContext } from '../types';
import { verifySession } from '../lib/jwt';

/**
 * Gate for /api/* routes. Expects `Authorization: Bearer <session-jwt>`,
 * verifies it, and exposes the payload via `c.get('session')`.
 */
export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const session = await verifySession(token, c.env.JWT_SECRET);
  if (!session) return c.json({ error: 'unauthorized' }, 401);

  c.set('session', session);
  await next();
});
