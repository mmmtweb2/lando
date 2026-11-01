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

export interface StatePayload { email: string; exp: number; n: string }

const stateKey = (key: Buffer) => crypto.createHmac('sha256', key).update('gbp-oauth-state-v1').digest();

/** state = base64url(json) + "." + HMAC. Ties the callback to the account that started the flow. */
export function signState(email: string, key: Buffer, now = Date.now(), ttlMs = 10 * 60 * 1000): string {
  const body = b64(Buffer.from(JSON.stringify({ email, exp: now + ttlMs, n: crypto.randomBytes(8).toString('hex') } satisfies StatePayload)));
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
