import { Hono } from 'hono';
import type { AppContext } from '../types';
import {
  buildAuthUrl,
  exchangeCode,
  decodeIdToken,
  cacheAccessToken,
} from '../lib/google';
import { createSupabase } from '../lib/supabase';
import { signSession, verifySession } from '../lib/jwt';

export const authRouter = new Hono<AppContext>();

const STATE_TTL = 600; // 10 minutes
const stateKey = (state: string) => `oauth_state:${state}`;

// GET /auth/google — start the consent flow.
authRouter.get('/google', async (c) => {
  const state = crypto.randomUUID();
  await c.env.TOKENS.put(stateKey(state), '1', { expirationTtl: STATE_TTL });
  return c.redirect(buildAuthUrl(c.env, state));
});

// GET /auth/google/callback — exchange code, persist refresh_token, hand the
// SPA a session JWT via URL fragment.
authRouter.get('/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const oauthError = c.req.query('error');
  if (oauthError) return c.text(`Google OAuth error: ${oauthError}`, 400);
  if (!code || !state) return c.text('missing code or state', 400);

  // CSRF: state must match a nonce we issued.
  const validState = await c.env.TOKENS.get(stateKey(state));
  if (!validState) return c.text('invalid state', 400);
  await c.env.TOKENS.delete(stateKey(state));

  const token = await exchangeCode(c.env, code);
  if (!token.refresh_token) {
    return c.text(
      'No refresh_token returned. Revoke prior access at ' +
        'https://myaccount.google.com/permissions and try again.',
      400,
    );
  }
  if (!token.id_token) return c.text('missing id_token', 400);
  const { email } = decodeIdToken(token.id_token);

  const supabase = createSupabase(c.env);
  const expiry = new Date(Date.now() + token.expires_in * 1000).toISOString();

  // Single user: one row keyed by email; id stays stable across re-auth.
  const { data: existing } = await supabase
    .from('google_accounts')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  let accountId: string;
  if (existing?.id) {
    accountId = existing.id as string;
    await supabase
      .from('google_accounts')
      .update({ refresh_token: token.refresh_token, scope: token.scope, token_expiry: expiry })
      .eq('id', accountId);
  } else {
    const { data: inserted, error } = await supabase
      .from('google_accounts')
      .insert({
        email,
        refresh_token: token.refresh_token,
        scope: token.scope,
        token_expiry: expiry,
      })
      .select('id')
      .single();
    if (error || !inserted) return c.text('failed to persist account', 500);
    accountId = inserted.id as string;
  }

  await cacheAccessToken(c.env, accountId, token.access_token, token.expires_in);

  const jwt = await signSession({ sub: accountId, email }, c.env.JWT_SECRET);
  // Fragment keeps the token out of server logs / Referer headers.
  return c.redirect(`${c.env.FRONTEND_ORIGIN}/#token=${encodeURIComponent(jwt)}`);
});

// GET /auth/status — lightweight check the SPA calls on boot.
authRouter.get('/status', async (c) => {
  const header = c.req.header('Authorization') ?? '';
  const tokenStr = header.startsWith('Bearer ') ? header.slice(7) : '';
  const session = tokenStr ? await verifySession(tokenStr, c.env.JWT_SECRET) : null;
  if (!session) return c.json({ authenticated: false });

  const supabase = createSupabase(c.env);
  const { data } = await supabase
    .from('google_accounts')
    .select('email, scope')
    .eq('id', session.sub)
    .maybeSingle();

  return c.json({
    authenticated: true,
    email: (data?.email as string) ?? session.email,
    scopes: data?.scope ? (data.scope as string).split(' ') : [],
  });
});
