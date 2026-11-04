// Encryption of customers' Google refresh tokens, and the signed `state` of the OAuth round trip.
// AES-256-GCM with a random IV per value; the blob is "v1.<iv>.<tag>.<ciphertext>" (base64url).
// Nothing here logs or returns a key or a token.

import crypto from 'crypto';

const b64 = (b: Buffer) => b.toString('base64url');

export function encryptToken(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', b64(iv), b64(c.getAuthTag()), b64(ct)].join('.');
}

/** The plain text, or null when the blob is malformed, tampered with, or the key is wrong. */
export function decryptToken(blob: string, key: Buffer): string | null {
  try {
    const [v, iv, tag, ct] = blob.split('.');
    if (v !== 'v1' || !iv || !tag || !ct) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
}

/** `b` = SHA-256 of the per-browser nonce that was also set as an httpOnly cookie at /oauth/start. */
export interface StatePayload { email: string; exp: number; n: string; b?: string }

const stateKey = (key: Buffer) => crypto.createHmac('sha256', key).update('gbp-oauth-state-v1').digest();

/** A fresh random nonce for the browser that starts the flow (goes in a cookie, never in the URL). */
export const newBrowserNonce = (): string => crypto.randomBytes(24).toString('hex');
const nonceDigest = (nonce: string): string => crypto.createHash('sha256').update(nonce).digest('hex');

/**
 * state = base64url(json) + "." + HMAC. Ties the callback to the account that started the flow AND,
 * when `browserNonce` is given, to the browser that started it (login-CSRF protection: a state
 * minted by an attacker is useless in a victim's browser, which does not hold the matching cookie).
 * The state carries only the nonce's SHA-256, so the URL never exposes the cookie value.
 */
export function signState(email: string, key: Buffer, now = Date.now(), ttlMs = 10 * 60 * 1000, browserNonce?: string): string {
  const payload: StatePayload = { email, exp: now + ttlMs, n: crypto.randomBytes(8).toString('hex') };
  if (browserNonce) payload.b = nonceDigest(browserNonce);
  const body = b64(Buffer.from(JSON.stringify(payload)));
  const mac = b64(crypto.createHmac('sha256', stateKey(key)).update(body).digest());
  return `${body}.${mac}`;
}

export function verifyState(state: unknown, key: Buffer, now = Date.now()): StatePayload | null {
  if (typeof state !== 'string' || state.length > 2000) return null;
  const [body, mac] = state.split('.');
  if (!body || !mac) return null;
  const want = crypto.createHmac('sha256', stateKey(key)).update(body).digest();
  let got: Buffer;
  try { got = Buffer.from(mac, 'base64url'); } catch { return null; }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    if (typeof p.email !== 'string' || typeof p.exp !== 'number' || p.exp < now) return null;
    return p;
  } catch { return null; }
}

/** True only when the state carries a browser binding AND the presented cookie nonce matches it. */
export function stateMatchesBrowser(p: StatePayload, cookieNonce: unknown): boolean {
  if (typeof p.b !== 'string' || typeof cookieNonce !== 'string' || !cookieNonce || cookieNonce.length > 200) return false;
  const want = Buffer.from(p.b, 'utf8');
  const got = Buffer.from(nonceDigest(cookieNonce), 'utf8');
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
