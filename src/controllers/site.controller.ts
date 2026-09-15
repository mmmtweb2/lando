import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

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
