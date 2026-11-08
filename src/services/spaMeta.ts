import type { Request, Response } from 'express';
import { readFile } from 'fs/promises';

// Per-route <head> tags for the marketing pages the SPA serves from one index.html.
// Without this, a crawler or a WhatsApp/Facebook link preview (no JS) sees the HOME page's
// title/description for /seo and /audit. The table is fixed in code: nothing from the request
// is ever written into the HTML, only a normalized pathname is used as a lookup key.

export interface SpaMeta { title: string; description: string; path: string }

export const SITE_URL = 'https://pagey.co.il';

// Keep the texts in sync with the client (SeoLanding.tsx Helmet, PublicAudit.tsx document.title).
export const SPA_META: Record<string, SpaMeta> = {
  // The home page keeps the title/description already in client/index.html; the entry only adds the canonical.
  '/': {
    path: '/',
    title: 'Pagey — דף נחיתה מקצועי בדקה בערך',
    description: 'Pagey בונה לעסק שלכם דף נחיתה מקצועי ומותאם למובייל בדקה בערך, בעזרת AI — בעברית, בלי מעצב ובלי מתכנת. בונים בחינם, משלמים רק כשמפרסמים.',
  },
  '/login': {
    path: '/login',
    title: 'התחברות | Pagey',
    description: 'התחברו לחשבון Pagey כדי לנהל את דפי הנחיתה והקידום שלכם בגוגל.',
  },
  '/seo': {
    path: '/seo',
    title: 'בדיקה חינמית לכרטיס העסק שלך בגוגל | Pagey',
    description: 'בדוק בחינם, בדקה, מה חסר בכרטיס העסק שלך בגוגל ואיך הוא מוגדר לעומת עסקים דומים באזור. בלי הבטחות ובלי חבילות מנופחות.',
  },
  '/audit': {
    path: '/audit',
    title: 'בדיקת כרטיס העסק בגוגל מפות, בחינם | Pagey',
    description: 'בדיקה חינמית של כרטיס העסק בגוגל מפות: מה חסר בו ואיך הוא מוגדר לעומת עסקים דומים באזור.',
  },
};

export function metaForPath(pathname: string): SpaMeta | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return Object.prototype.hasOwnProperty.call(SPA_META, p) ? SPA_META[p] : null;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setMeta(html: string, attr: 'name' | 'property', key: string, value: string): string {
  const re = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`);
  return re.test(html) ? html.replace(re, (_m, a, b) => `${a}${esc(value)}${b}`) : html;
}

/** Returns the index.html with the head tags of `meta` (pure; unknown shape of html → unchanged tags). */
export function applySpaMeta(html: string, meta: SpaMeta): string {
  const url = `${SITE_URL}${meta.path}`;
  let out = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`);
  out = setMeta(out, 'name', 'description', meta.description);
  out = setMeta(out, 'property', 'og:title', meta.title);
  out = setMeta(out, 'property', 'og:description', meta.description);
  out = setMeta(out, 'property', 'og:url', url);
  out = setMeta(out, 'name', 'twitter:title', meta.title);
  out = setMeta(out, 'name', 'twitter:description', meta.description);
  if (!/rel="canonical"/.test(out)) out = out.replace('</head>', `    <link rel="canonical" href="${url}" />\n  </head>`);
  return out;
}

/**
 * For a route in the table: sends index.html with that route's head tags and returns true.
 * For any other route returns false and the caller sends the file unchanged, as before.
 * If the file cannot be read, falls back to the plain file (never a 500 for a page view).
 */
export function serveSpaWithMeta(req: Request, res: Response, indexPath: string): boolean {
  const meta = metaForPath(req.path);
  if (!meta) return false;
  readFile(indexPath, 'utf-8')
    .then((html) => { res.status(200).type('html').send(applySpaMeta(html, meta)); })
    .catch(() => { res.status(200).sendFile(indexPath); });
  return true;
}
