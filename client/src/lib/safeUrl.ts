// Only absolute http(s) URLs may become an <a href>. A `javascript:` / `data:` href on a public
// landing page would run script in the visitor's browser. The server validates on write
// (src/utils/safeUrl.ts); this is the render-side guard for anything already stored.

/** The canonical http(s) URL, or null (render no link). Strict: no bare hosts, no credentials. */
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 2048 || /[\s\u0000-\u001f\u007f<>"'`\\]/.test(s)) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname || u.username || u.password) return null;
  return u.href;
}
