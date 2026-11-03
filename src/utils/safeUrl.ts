// Server-side URL hygiene for owner-supplied links (facebook_url, instagram_url, external_link).
// These are later rendered as <a href> on public pages and as JSON-LD `sameAs`, so a
// `javascript:` / `data:` / `vbscript:` value would be stored XSS on a customer's public page.
// Only absolute http(s) URLs are ever accepted.

const MAX_URL_LENGTH = 2048;
const HAS_SCHEME = /^[a-z][a-z0-9+.\-]*:/i;
// "www.facebook.com/foo", "instagram.com/foo": a bare host the owner typed without https://.
const BARE_HOST = /^(?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#]|$)/i;

export interface ParseOptions {
  /** Accept "facebook.com/x" (no scheme) and upgrade it to https://. Default false (strict). */
  allowBare?: boolean;
}

/**
 * The canonical absolute http(s) URL, or null. Rejects: non-strings, empty, > 2048 chars, any
 * whitespace/control character, every scheme other than http/https, protocol-relative `//x`,
 * embedded credentials (`https://user:pw@host`), and hosts the WHATWG parser rejects.
 */
export function parseHttpUrl(raw: unknown, opts: ParseOptions = {}): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s || s.length > MAX_URL_LENGTH) return null;
  if (/[\s\u0000-\u001f\u007f\u2028\u2029<>"'`\\]/.test(s)) return null;
  if (s.startsWith('//')) return null;
  if (!HAS_SCHEME.test(s)) {
    if (!opts.allowBare || !BARE_HOST.test(s)) return null;
    s = `https://${s}`;
  }
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname || u.username || u.password) return null;
  return u.href;
}

export const isHttpUrl = (raw: unknown): boolean => parseHttpUrl(raw) !== null;

/**
 * For an optional form field: undefined/empty -> { ok: true, value: null }; a valid link ->
 * { ok: true, value: canonical }; anything else -> { ok: false } so the caller can answer 400.
 */
export function optionalHttpUrl(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false };
  if (!raw.trim()) return { ok: true, value: null };
  const v = parseHttpUrl(raw, { allowBare: true });
  return v ? { ok: true, value: v } : { ok: false };
}
