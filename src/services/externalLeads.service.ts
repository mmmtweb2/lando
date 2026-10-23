// Inquiries that happen on a customer's OWN website (outside Pagey), reported by the tracking
// snippet (/w/track.js). They are lead_events rows with business_id set and landing_page_id
// NULL (migration 027). Everything here is best-effort and fail-safe: if migration 027 is
// missing, or a query fails, the Pagey leads feed must keep working exactly as before.

import { supabase } from '../config/supabase';
import { LEAD_EVENT_TYPES, SMOKE_SOURCE, type LeadEventType } from './leadEvents.service';
import { hasProduct } from './entitlements.service';

const NOT_SMOKE = `source_url.is.null,source_url.neq.${SMOKE_SOURCE}`;
const FEED_LIMIT = 500;

/** Snippet events are inquiries only: the snippet never reports outbound 'link' clicks. */
export const EXTERNAL_EVENT_TYPES: readonly LeadEventType[] = LEAD_EVENT_TYPES.filter(t => t !== 'link');

export function isExternalEventType(v: unknown): v is LeadEventType {
  return typeof v === 'string' && (EXTERNAL_EVENT_TYPES as readonly string[]).includes(v);
}

const clip = (v: unknown, max = 500): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

// Per-business daily ceiling: a public, unauthenticated endpoint must not be a free way to fill
// the database. In-memory, single instance (like the other limiters).
const perDay = new Map<string, { day: string; n: number }>();
export function underEventCap(businessId: string): boolean {
  const cap = Number(process.env.SEO_TRACK_DAILY_CAP) > 0 ? Number(process.env.SEO_TRACK_DAILY_CAP) : 2000;
  const day = new Date().toISOString().slice(0, 10);
  const u = perDay.get(businessId);
  if (!u || u.day !== day) { perDay.set(businessId, { day, n: 1 }); return true; }
  if (u.n >= cap) return false;
  u.n += 1;
  return true;
}

/** Records one inquiry click. Silent: unknown business, no active product, over cap -> nothing. */
export async function recordExternalEvent(
  businessId: string, type: LeadEventType, sourceUrl: unknown, referrer: unknown,
): Promise<void> {
  const { data: biz, error } = await supabase
    .from('seo_businesses').select('id, owner_email').eq('id', businessId).maybeSingle();
  if (error || !biz) return;
  if (!(await hasProduct((biz as { owner_email: string }).owner_email, 'seo_autopilot'))) return;
  if (!underEventCap(businessId)) return;
  const { error: insErr } = await supabase.from('lead_events').insert({
    business_id: businessId,
    event_type: type,
    source_url: clip(sourceUrl),
    referrer: clip(referrer),
  });
  if (insErr) console.error('[EXTERNAL_LEADS] insert failed:', insErr.message);
}

export interface ExternalItem {
  id: string; kind: LeadEventType; created_at: string; landing_page_id: string;
  name: null; phone: null; email: null; message: null; page_name: string; page_slug: null;
}
export interface ExternalLeads {
  items: ExternalItem[];
  month: { whatsapp: number; call: number; email: number };
}

const EMPTY: ExternalLeads = { items: [], month: { whatsapp: 0, call: 0, email: 0 } };

/** The owner's external-site inquiries (feed + this month's counts). Never throws. */
export async function getExternalLeads(email: string, monthStartIso: string): Promise<ExternalLeads> {
  try {
    const { data: bizRows, error } = await supabase
      .from('seo_businesses').select('id, name').eq('owner_email', email);
    if (error || !bizRows || bizRows.length === 0) return EMPTY;
    const names = new Map((bizRows as { id: string; name: string }[]).map(b => [b.id, b.name]));
    const ids = [...names.keys()];

    const count = (type: string) =>
      supabase.from('lead_events').select('id', { count: 'exact', head: true })
        .in('business_id', ids).eq('event_type', type).gte('created_at', monthStartIso).or(NOT_SMOKE);
    const [feed, cWa, cCall, cEmail] = await Promise.all([
      supabase.from('lead_events').select('id, event_type, created_at, business_id')
        .in('business_id', ids).in('event_type', [...EXTERNAL_EVENT_TYPES]).or(NOT_SMOKE)
        .order('created_at', { ascending: false }).limit(FEED_LIMIT),
      count('whatsapp'), count('call'), count('email'),
    ]);
    if ([feed, cWa, cCall, cEmail].some(r => r.error)) return EMPTY;

    return {
      items: ((feed.data ?? []) as { id: string; event_type: LeadEventType; created_at: string; business_id: string }[])
        .map(e => ({
          id: e.id, kind: e.event_type, created_at: e.created_at, landing_page_id: e.business_id,
          name: null, phone: null, email: null, message: null,
          page_name: `${names.get(e.business_id) ?? 'עסק'} (אתר חיצוני)`, page_slug: null,
        })),
      month: { whatsapp: cWa.count ?? 0, call: cCall.count ?? 0, email: cEmail.count ?? 0 },
    };
  } catch (e) {
    console.error('[EXTERNAL_LEADS] lookup failed:', e);
    return EMPTY;
  }
}
