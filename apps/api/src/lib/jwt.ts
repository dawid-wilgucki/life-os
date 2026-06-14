// Minimal HS256 JWT for the single-user session, using Web Crypto (no deps).

const encoder = new TextEncoder();

export interface SessionPayload {
  /** subject = the single user's Google account id (sub claim). */
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlEncodeString(str: string): string {
  return b64urlEncode(encoder.encode(str));
}

function b64urlDecodeToString(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4 ? 4 - (str.length % 4) : 0;
  return atob(str + '='.repeat(pad));
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — single-user convenience.

export async function signSession(
  claims: { sub: string; email: string },
  secret: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: claims.sub,
    email: claims.email,
    iat: now,
    exp: now + ttlSeconds,
  };
  const header = b64urlEncodeString(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64urlEncodeString(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return `${data}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const data = `${header}.${body}`;
  const key = await importKey(secret);

  const expected = b64urlEncode(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data))),
  );
  // Constant-time-ish compare (lengths equal for HS256 b64url).
  if (expected.length !== signature.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (diff !== 0) return null;

  try {
    const payload = JSON.parse(b64urlDecodeToString(body)) as SessionPayload;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
