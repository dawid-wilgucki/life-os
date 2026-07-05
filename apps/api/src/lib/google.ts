// Google OAuth + token lifecycle. refresh_token lives in Supabase; the
// short-lived access_token is cached in KV (binding TOKENS).

import type { Env } from '../types';
import { createSupabase } from './supabase';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// `drive.file` only grants access to files the app itself created (or that
// the user picked via Google Picker) — it does NOT cover the pre-existing
// wardrobe JSON the user uploaded to Drive by hand. Writing to that file
// (add/edit/delete wardrobe items) needs the full `drive` scope instead.
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/gmail.readonly',
];

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  token_type: string;
}

const accessTokenKey = (accountId: string) => `access_token:${accountId}`;

/** Build the consent URL. offline + consent guarantee a refresh_token. */
export function buildAuthUrl(env: Env, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(env: Env, code: string): Promise<GoogleTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(
  env: Env,
  refreshToken: string,
): Promise<GoogleTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`token refresh failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Decode (not cryptographically verify) a Google id_token's claims. */
export function decodeIdToken(idToken: string): { sub: string; email: string } {
  const part = idToken.split('.')[1] ?? '';
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? 4 - (b64.length % 4) : 0;
  const data = JSON.parse(atob(b64 + '='.repeat(pad)));
  return { sub: data.sub, email: data.email };
}

/** Store a freshly-issued access token in KV with a safety-margin TTL. */
export async function cacheAccessToken(
  env: Env,
  accountId: string,
  accessToken: string,
  expiresIn: number,
): Promise<void> {
  const ttl = Math.max(60, expiresIn - 60);
  await env.TOKENS.put(accessTokenKey(accountId), accessToken, { expirationTtl: ttl });
}

/**
 * Return a valid access token for the account: KV cache first, otherwise
 * refresh using the stored refresh_token and re-cache.
 */
export async function getAccessToken(
  env: Env,
  accountId: string,
  forceRefresh = false,
): Promise<string> {
  if (!forceRefresh) {
    const cached = await env.TOKENS.get(accessTokenKey(accountId));
    if (cached) return cached;
  }

  const supabase = createSupabase(env);
  const { data, error } = await supabase
    .from('google_accounts')
    .select('refresh_token')
    .eq('id', accountId)
    .single();
  if (error || !data?.refresh_token) {
    throw new Error('no stored refresh_token for account');
  }

  const token = await refreshAccessToken(env, data.refresh_token as string);
  await cacheAccessToken(env, accountId, token.access_token, token.expires_in);
  await supabase
    .from('google_accounts')
    .update({ token_expiry: new Date(Date.now() + token.expires_in * 1000).toISOString() })
    .eq('id', accountId);
  return token.access_token;
}

/**
 * Authenticated fetch against a Google API. Transparently refreshes once on a
 * 401 (e.g. token revoked / cache stale).
 */
function authFailedResponse(err: unknown): Response {
  return new Response(JSON.stringify({ error: 'google_auth_failed', detail: String(err) }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Authenticated fetch against a Google API. Transparently refreshes once on a
 * 401 (e.g. token revoked / cache stale). If no valid token can be obtained at
 * all (revoked/missing refresh_token), this returns a 401 Response instead of
 * throwing — callers already treat a non-ok Response as "Google unavailable"
 * and degrade gracefully, whereas a thrown error would crash the whole route.
 */
export async function googleFetch(
  env: Env,
  accountId: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const withAuth = (token: string): RequestInit => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return { ...init, headers };
  };

  let token: string;
  try {
    token = await getAccessToken(env, accountId);
  } catch (err) {
    return authFailedResponse(err);
  }

  let res = await fetch(url, withAuth(token));
  if (res.status === 401) {
    try {
      token = await getAccessToken(env, accountId, true);
    } catch (err) {
      return authFailedResponse(err);
    }
    res = await fetch(url, withAuth(token));
  }
  return res;
}
