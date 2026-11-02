// Funnel events and the small things the journey remembers in the browser (task #9).
//
// Events go to OUR server (operational funnel log, no third party). They carry an anonymous random
// id so a visit to /audit can later be linked to the account created from it; nothing personal is
// sent (the server drops every property that is not on a short allow-list). Marketing tags (GTM)
// are separate and stay behind the consent bar. Everything here fails silently.

import { authFetch } from './api';

const ANON = 'pagey_anon_id';
const ATTR = 'pagey_attr';
const PENDING = 'pagey_pending_place';

function read(k: string): string | null { try { return window.localStorage.getItem(k); } catch { return null; } }
function write(k: string, v: string) { try { window.localStorage.setItem(k, v); } catch { /* not remembered */ } }
function drop(k: string) { try { window.localStorage.removeItem(k); } catch { /* ignore */ } }

export function anonId(): string {
  const cur = read(ANON);
  if (cur && /^[A-Za-z0-9_-]{8,64}$/.test(cur)) return cur;
  let id: string;
  try { id = crypto.randomUUID().replace(/-/g, ''); } catch { id = (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).slice(0, 24).padEnd(12, 'x'); }
  write(ANON, id);
  return id;
}

export interface Attribution { source?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string }

/** First touch wins: the campaign that brought the visitor is kept until they sign up. */
export function attribution(): Attribution {
  const stored = read(ATTR);
  if (stored) { try { return JSON.parse(stored) as Attribution; } catch { /* fall through */ } }
  const out: Attribution = {};
  try {
    const q = new URLSearchParams(window.location.search);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign'] as const) { const v = q.get(k); if (v && /^[\w .\-+%]{1,100}$/.test(v)) out[k] = v; }
    if (document.referrer) { const h = new URL(document.referrer).hostname; if (h && h !== window.location.hostname && /^[\w.-]{1,100}$/.test(h)) out.source = h; }
  } catch { /* no query */ }
  if (Object.keys(out).length) write(ATTR, JSON.stringify(out));
  return out;
}

/** Anonymous visitor event. Never throws, never waits. */
export function trackPublic(event: 'audit_started' | 'audit_completed' | 'recs_viewed', props: Record<string, unknown> = {}): void {
  try {
    void fetch('/api/public/journey/event', {
      method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, anonId: anonId(), props, attribution: attribution() }),
    }).catch(() => undefined);
  } catch { /* tracking must never break the page */ }
}

/** Signed-in customer event. */
export function trackAccount(event: 'recs_viewed' | 'activation_viewed' | 'setup_step_completed' | 'dashboard_viewed', props: Record<string, unknown> = {}): void {
  try {
    void authFetch('/api/seo/journey/event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, props, anonId: anonId(), attribution: attribution() }),
    }).catch(() => undefined);
  } catch { /* ignore */ }
}

/** The business picked on /audit, carried through sign-up (only the Google place id). */
export function rememberPlace(placeId: string): void { if (/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) write(PENDING, placeId); }
export function takePlace(): string | null {
  const v = read(PENDING);
  drop(PENDING);
  return v && /^[A-Za-z0-9_-]{10,300}$/.test(v) ? v : null;
}
