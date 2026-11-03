// Google Tag Manager, loaded only after the visitor agrees (see components/MarketingTags.tsx).
// Pure helpers so they can be tested without a browser.

export const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/;
export const CONSENT_KEY = 'pagey_marketing_consent';
export type Consent = 'granted' | 'denied' | null;

/** Pages where measurement may run: public marketing pages only, never account/admin/customer pages. */
export function marketingPath(pathname: string): boolean {
  return pathname === '/' || pathname === '/audit' || pathname === '/seo';
}

export function readConsent(): Consent {
  try { const v = localStorage.getItem(CONSENT_KEY); return v === 'granted' || v === 'denied' ? v : null; } catch { return null; }
}
export function writeConsent(v: 'granted' | 'denied'): void {
  try { localStorage.setItem(CONSENT_KEY, v); } catch { /* private mode: the choice lasts until reload */ }
}

export function gtmSrc(id: string): string | null {
  return GTM_ID.test(id) ? `https://www.googletagmanager.com/gtm.js?id=${id}` : null;
}

/** Injects the container once. Safe to call repeatedly. */
export function loadGtm(id: string): boolean {
  const src = gtmSrc(id);
  if (!src || typeof document === 'undefined') return false;
  if (document.getElementById('pagey-gtm')) return true;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  const s = document.createElement('script');
  s.id = 'pagey-gtm'; s.async = true; s.src = src;
  document.head.appendChild(s);
  return true;
}
