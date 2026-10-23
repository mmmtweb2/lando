// Stage 6.2 — public, embeddable Google-reviews widget:  GET /w/reviews/:businessId
//
// Public on purpose (it is embedded in customers' own websites), so every guard is about
// cost and abuse, not identity:
//   • businessId is the widget's only input: an unguessable UUID of a saved business, so the
//     route cannot be used as an open proxy to Places for arbitrary place ids;
//   • the owner must currently hold seo_autopilot;
//   • live Places calls are capped per business and in total per day; over the cap the page
//     still works but shows only the "write a review" button (no Google content);
//   • nothing from Places is cached or stored (policy) — responses are `no-store`;
//   • `noindex` so crawlers do not trigger billable fetches.

import { Request, Response } from 'express';
import { PlacesError, fetchPlaceReviews, placesConfigured } from '../services/places.service';
import { getBusinessForWidget } from '../services/seoBusinesses.service';
import { hasProduct } from '../services/entitlements.service';
import { renderReviewsFallback, renderReviewsUnavailable, renderReviewsWidget } from '../services/reviewsWidgetRender';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function intEnv(name: string, dflt: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
}

// In-memory, per day (UTC). Single instance, like middleware/rateLimit.ts.
const state = { day: '', total: 0, perBusiness: new Map<string, number>() };

/** Reserves one live fetch; false when this business or the whole service is over budget. */
export function takeLiveFetch(businessId: string): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (state.day !== day) { state.day = day; state.total = 0; state.perBusiness.clear(); }
  const perBusinessCap = intEnv('REVIEWS_WIDGET_DAILY_CAP', 300);
  const totalCap = intEnv('REVIEWS_WIDGET_TOTAL_DAILY_CAP', 2000);
  const mine = state.perBusiness.get(businessId) ?? 0;
  if (mine >= perBusinessCap || state.total >= totalCap) return false;
  state.perBusiness.set(businessId, mine + 1);
  state.total += 1;
  return true;
}

function send(res: Response, status: number, html: string): void {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  // Must be embeddable anywhere: no X-Frame-Options, and an explicit permissive frame-ancestors.
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *; default-src 'none'; img-src https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
  res.send(html);
}

export async function serveReviewsWidget(req: Request, res: Response): Promise<void> {
  const { businessId } = req.params;
  if (!UUID_RE.test(businessId)) { send(res, 404, renderReviewsUnavailable()); return; }
  try {
    const biz = await getBusinessForWidget(businessId);
    if (!biz?.google_place_id || !placesConfigured() || !(await hasProduct(biz.owner_email, 'seo_autopilot'))) {
      send(res, 404, renderReviewsUnavailable());
      return;
    }
    if (!takeLiveFetch(biz.id)) { send(res, 200, renderReviewsFallback(biz.google_place_id)); return; }
    try {
      const data = await fetchPlaceReviews(biz.google_place_id);
      send(res, 200, renderReviewsWidget(data, biz.google_place_id));
    } catch (e) {
      if (e instanceof PlacesError && e.code === 'not_configured') { send(res, 404, renderReviewsUnavailable()); return; }
      // Google unreachable / place gone: degrade to the button rather than break the customer's site.
      send(res, 200, renderReviewsFallback(biz.google_place_id));
    }
  } catch (e) {
    console.error('[REVIEWS] widget failed:', e);
    send(res, 500, renderReviewsUnavailable());
  }
}
