// Inquiry tracking for a customer's OWN website (outside Pagey).
//   GET  /w/track.js                       the snippet (one tiny script; business id in data-b)
//   POST /api/seo/track/:businessId?t=...  what the snippet calls (public, always 204)
//
// Public on purpose, so: always 204 (nothing about a business's existence or status leaks), a
// fixed event allowlist (whatsapp|call|email), per-IP burst limit on the route, a per-business
// daily cap and an active-product check in the service. The request carries everything in the
// query string so navigator.sendBeacon can send it without a body or a CORS preflight.

import { Request, Response } from 'express';
import { isExternalEventType, recordExternalEvent } from '../services/externalLeads.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function trackExternalEvent(req: Request, res: Response): Promise<void> {
  // Any origin may report (the snippet lives on customers' sites). No credentials are involved.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const { businessId } = req.params;
  const t = req.query.t;
  if (UUID_RE.test(businessId) && isExternalEventType(t)) {
    try {
      await recordExternalEvent(businessId, t, req.query.u, req.query.r);
    } catch (e) {
      console.error('[EXTERNAL_LEADS] track failed:', e);
    }
  }
  res.status(204).end();
}

/** CORS preflight for clients that do send a non-simple request. */
export function trackPreflight(_req: Request, res: Response): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.status(204).end();
}

// The snippet. Plain ES5, no dependencies, never throws into the host page. It only READS link
// clicks (tel:, mailto:, WhatsApp) and sends the type, the page URL and the referrer.
export const TRACK_SCRIPT = `(function () {
  try {
    var s = document.currentScript;
    var b = s && s.getAttribute('data-b');
    if (!b || !/^[0-9a-f-]{36}$/i.test(b)) return;
    var base = new URL(s.src).origin + '/api/seo/track/' + b;
    var last = { t: '', at: 0 };
    function kind(href) {
      if (/^tel:/i.test(href)) return 'call';
      if (/^mailto:/i.test(href)) return 'email';
      if (/^https?:\\/\\/(wa\\.me|api\\.whatsapp\\.com|web\\.whatsapp\\.com|chat\\.whatsapp\\.com)(\\/|\\?|$)/i.test(href)) return 'whatsapp';
      return '';
    }
    function send(t) {
      var now = Date.now();
      if (last.t === t && now - last.at < 1500) return;
      last = { t: t, at: now };
      var url = base + '?t=' + t + '&u=' + encodeURIComponent(location.href.slice(0, 400)) + '&r=' + encodeURIComponent((document.referrer || '').slice(0, 400));
      if (navigator.sendBeacon && navigator.sendBeacon(url)) return;
      if (window.fetch) fetch(url, { method: 'POST', keepalive: true, mode: 'no-cors' });
    }
    document.addEventListener('click', function (e) {
      try {
        var el = e.target;
        while (el && el !== document && !(el.tagName && el.tagName.toUpperCase() === 'A' && el.getAttribute('href'))) el = el.parentNode;
        if (!el || el === document) return;
        var t = kind(el.getAttribute('href'));
        if (t) send(t);
      } catch (_) {}
    }, true);
  } catch (_) {}
})();
`;

export function serveTrackScript(_req: Request, res: Response): void {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(TRACK_SCRIPT);
}
