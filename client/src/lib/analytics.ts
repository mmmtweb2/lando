// ─────────────────────────────────────────────────────────────────────────────
// analytics.ts — shared client-side tracking helper.
//
// Two responsibilities, both fire-and-forget and non-blocking:
//  - getOrCreateVisitorId(): a random per-browser id (localStorage), so the
//    admin traffic/funnel dashboards can approximate unique visitors. No PII.
//  - trackEvent(): logs one funnel-intent event (see migrations/022_funnel_events.sql)
//    — distinct from SiteTracker's automatic per-route pageviews (App.tsx):
//    this is for a specific user ACTION worth funnel analysis (signup attempt,
//    wizard step reached, checkout started), fired explicitly at the call site.
//
// Moved here from App.tsx (2026-09-24) so Login.tsx/Wizard.tsx/LandingViewer.tsx
// can share the same visitor id instead of each re-deriving it.
// ─────────────────────────────────────────────────────────────────────────────

const VISITOR_ID_KEY = 'pagey_visitor_id';

export function getOrCreateVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(VISITOR_ID_KEY, id);
    return id;
  } catch {
    // Private-browsing/storage-blocked fallback — a fresh id per call is fine,
    // it just won't count as a returning unique visitor.
    return crypto.randomUUID();
  }
}

/**
 * Log a funnel-intent event. Never throws, never awaited by the caller's own
 * flow — a failed/slow analytics call must never block or delay the real
 * user action (signup, step change, checkout).
 */
export function trackEvent(eventName: string, meta?: Record<string, unknown>): void {
  try {
    fetch('/api/site/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: eventName,
        visitorId: getOrCreateVisitorId(),
        meta: meta ?? null,
      }),
    }).catch(() => {});
  } catch {
    // crypto.randomUUID()/localStorage threw synchronously — ignore, never
    // let analytics break the actual user action.
  }
}
