import { supabase } from '../config/supabase';
import { trackPageCtaClick } from './analytics.service';

export const LEAD_EVENT_TYPES = ['whatsapp', 'call', 'email', 'link'] as const;

/** source_url marking a post-deploy smoke-test event: stored, never counted or shown. */
export const SMOKE_SOURCE = 'smoke-test';
export type LeadEventType = (typeof LEAD_EVENT_TYPES)[number];

export function isLeadEventType(v: unknown): v is LeadEventType {
  return typeof v === 'string' && (LEAD_EVENT_TYPES as readonly string[]).includes(v);
}

function clip(v: unknown, max = 500): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

/**
 * Record a WhatsApp / call click (migration 026) and bump the existing atomic
 * cta_click_count. Best-effort and silent: an unknown slug or a page that is not
 * live records nothing. A child (SEO) page has no status of its own — it counts
 * only while its parent is published.
 */
export async function recordLeadEvent(
  slug: string,
  type: LeadEventType,
  sourceUrl: unknown,
  referrer: unknown,
): Promise<void> {
  const { data: page } = await supabase
    .from('landing_pages')
    .select('id, status, parent_id')
    .eq('slug', slug)
    .maybeSingle();
  if (!page) return;

  const row = page as { id: string; status: string | null; parent_id: string | null };
  let status = row.status;
  if (row.parent_id) {
    const { data: parent } = await supabase.from('landing_pages').select('status').eq('id', row.parent_id).maybeSingle();
    status = (parent as { status?: string | null } | null)?.status ?? null;
  }
  if (status !== 'published') return;

  const source = clip(sourceUrl);
  const { error } = await supabase.from('lead_events').insert({
    landing_page_id: row.id,
    event_type: type,
    source_url: source,
    referrer: clip(referrer),
  });
  if (error) console.error('[LEAD_EVENTS] insert failed:', error.message);

  // A smoke-test event keeps its row but must not move the page's real CTA counter.
  if (source !== SMOKE_SOURCE) await trackPageCtaClick(slug);
}
