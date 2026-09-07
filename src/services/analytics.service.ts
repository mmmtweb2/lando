import { supabase } from '../config/supabase';

/**
 * Minimal v1 page analytics (see migrations/019_page_analytics.sql for full
 * reasoning). Both functions call a SECURITY DEFINER Postgres function that
 * does the whole read+increment in one atomic SQL statement — a plain
 * Supabase `.update()` here would need a read-then-write from Node, which
 * risks lost updates under real, bursty visitor concurrency. Both are
 * genuine no-ops (no error, no effect) for an unknown slug or a page that
 * isn't currently 'published' — the SQL function's own WHERE clause enforces
 * that, so this stays correct even if a caller forgets to check.
 */

export async function trackPageView(slug: string): Promise<void> {
  const { error } = await supabase.rpc('increment_page_view', { p_slug: slug });
  if (error) console.error('[ANALYTICS] increment_page_view RPC failed:', error.message);
}

export async function trackPageCtaClick(slug: string): Promise<void> {
  const { error } = await supabase.rpc('increment_page_cta_click', { p_slug: slug });
  if (error) console.error('[ANALYTICS] increment_page_cta_click RPC failed:', error.message);
}
