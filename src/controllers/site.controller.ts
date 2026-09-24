import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { logFunnelEvent } from '../services/funnel.service';

/**
 * POST /api/site/track
 *
 * Public, unauthenticated, fire-and-forget event log for MARKETING-site
 * traffic (see migrations/021_site_visits.sql). Mirrors the existing
 * landing-page analytics pattern (landing.controller.ts's trackView):
 * respond immediately, do the write best-effort, never surface a DB
 * hiccup to the visitor. Rate limiting lives in site.routes.ts (siteTrackLimiter).
 *
 * Body is entirely client-supplied and untrusted — every field is
 * truncated defensively before insert so a malformed/abusive payload can
 * never blow up a query or bloat a row unboundedly.
 */
export async function trackSiteVisit(req: Request, res: Response): Promise<void> {
  res.status(204).send();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const clip = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string' || !v.trim()) return null;
    return v.slice(0, max);
  };

  const path = clip(body.path, 300);
  const visitorId = clip(body.visitorId, 100);
  if (!path || !visitorId) return; // both required — nothing meaningful to log without them

  const row = {
    path,
    visitor_id: visitorId,
    referrer: clip(body.referrer, 500),
    utm_source: clip(body.utmSource, 100),
    utm_medium: clip(body.utmMedium, 100),
    utm_campaign: clip(body.utmCampaign, 100),
  };

  const { error } = await supabase.from('site_visits').insert(row);
  if (error) console.error('[SITE ANALYTICS] trackSiteVisit failed:', error.message);
}


/**
 * POST /api/site/event
 *
 * Public, unauthenticated, fire-and-forget FUNNEL-INTENT event log (see
 * migrations/022_funnel_events.sql). Distinct from trackSiteVisit above
 * (pageviews) — this logs a specific user action worth funnel analysis
 * (started signup, reached a wizard step, opened checkout). Some funnel
 * steps that represent something actually HAPPENING server-side (account
 * created, page created/published, payment completed) are logged directly
 * from the relevant controller instead of from here — more reliable than a
 * client fire-and-forget call, since they only fire once the real thing
 * actually succeeded.
 *
 * `event` is checked against an allowlist since this body is entirely
 * client-supplied and untrusted — an open-ended event_name would let anyone
 * write arbitrary strings into the funnel dashboard.
 */
const CLIENT_EVENT_ALLOWLIST = new Set([
  'signup_attempt',
  'wizard_started',
  'wizard_step_reached',
  'checkout_started',
]);

export async function trackFunnelEvent(req: Request, res: Response): Promise<void> {
  res.status(204).send();

  const body = (req.body ?? {}) as Record<string, unknown>;
  const event = typeof body.event === 'string' ? body.event : '';
  if (!CLIENT_EVENT_ALLOWLIST.has(event)) return;

  const visitorId = typeof body.visitorId === 'string' && body.visitorId.trim() ? body.visitorId.slice(0, 100) : null;

  // meta is client-supplied and free-form (e.g. { step: 2, label: '...' }) —
  // cap its serialized size so a malformed/abusive payload can't bloat a row.
  let meta: Record<string, unknown> | null = null;
  if (body.meta && typeof body.meta === 'object') {
    const json = JSON.stringify(body.meta);
    if (json.length <= 2000) meta = body.meta as Record<string, unknown>;
  }

  await logFunnelEvent(event, { visitorId, meta });
}
