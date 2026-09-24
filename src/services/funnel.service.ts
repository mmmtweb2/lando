// ─────────────────────────────────────────────────────────────────────────────
// funnel.service.ts — shared logger for funnel_events (migrations/022).
//
// One tiny helper, used from two directions:
//  - site.controller.ts's trackFunnelEvent: a PUBLIC endpoint, for client-
//    fired INTENT events (signup_attempt, wizard_started, wizard_step_reached,
//    checkout_started) — untrusted input, so the event name is checked against
//    an allowlist there before this is ever called.
//  - Called directly from backend code for server-side TRUTH events
//    (signup_completed, page_created, page_published, purchase_completed) —
//    these are more reliable than a client fire-and-forget call because they
//    only fire once the real thing actually happened server-side.
//
// Always best-effort: logs and swallows failures, never blocks the real
// operation it's attached to (same discipline as every other mailer/analytics
// helper in this codebase).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../config/supabase';

export async function logFunnelEvent(
  eventName: string,
  opts?: { visitorId?: string | null; userEmail?: string | null; meta?: Record<string, unknown> | null },
): Promise<void> {
  try {
    const { error } = await supabase.from('funnel_events').insert({
      event_name: eventName,
      visitor_id: opts?.visitorId ?? null,
      user_email: opts?.userEmail ?? null,
      meta: opts?.meta ?? null,
    });
    if (error) console.error('[FUNNEL] insert failed:', error.message);
  } catch (e) {
    console.error('[FUNNEL] logFunnelEvent failed:', e);
  }
}
