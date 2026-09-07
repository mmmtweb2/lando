-- ─────────────────────────────────────────────────────────────────────────────
-- 019_page_analytics.sql — minimal page-view / CTA-click counters (v1)
--                            (run in the Supabase SQL editor, same as 009-017)
--
-- ── The problem this closes ──────────────────────────────────────────────────
-- There is currently ZERO analytics/tracking anywhere in this codebase — an
-- owner has no way to know whether a published page is actually getting
-- traffic, let alone whether visitors click its primary CTA. This has been
-- flagged repeatedly (part 16's business audit named it the top business-
-- impact gap: both a competitive table-stakes gap and the acknowledged
-- internal blocker to ever having a credible renewal-value conversation).
--
-- ── Deliberately minimal v1, NOT a full analytics system ─────────────────────
-- This ships exactly two integer counters directly on `landing_pages`, not an
-- event-log table. The ask is "does this page get views, does its CTA get
-- clicked" — two numbers an owner can see on their dashboard — not a charted,
-- date-ranged analytics dashboard (that is an intentionally deferred v2; see
-- README). Counters avoid needing any aggregation query later for this v1
-- scope. A fuller event-level table (timestamped rows, one per view/click,
-- optionally with referrer/UA) can be added later as a genuine EXTENSION of
-- this — it would live alongside these columns, feeding them via the same
-- increment functions below, or superseding them — without conflicting with
-- anything here. Nothing about this migration blocks that future path.
--
-- ── Atomic increments ─────────────────────────────────────────────────────────
-- These counters are incremented from a PUBLIC, unauthenticated route hit by
-- real visitor traffic, which can be genuinely concurrent (many simultaneous
-- page loads). A read-then-write increment via the Supabase JS client's
-- `.update()` risks lost updates under that concurrency (two visitors' requests
-- both read count=N, both write N+1, one increment vanishes). Unlike the
-- existing "low-stakes display counter" precedent elsewhere in this codebase
-- (referral.service.ts's `earned_coupons`, incremented via plain read-then-
-- write — fine there because referral bonuses are rare, human-paced events),
-- page views/clicks are exactly the kind of frequent, bursty writes where lost
-- updates would actually happen. So instead of a read-then-write from Node,
-- these are incremented via two small SECURITY DEFINER Postgres functions that
-- do the whole read+write in one atomic SQL statement, called through
-- Supabase's `.rpc()`. Each is a silent no-op (returns void, never raises) when
-- the slug doesn't exist or the page isn't published — tracking a draft/frozen
-- page's private preview views, or leaking slug-existence via an error, is
-- never desired.
--
-- SAFE / RE-RUNNABLE: `IF NOT EXISTS` on the columns, `CREATE OR REPLACE` on
-- the functions, additive only, changes no existing data.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS view_count      integer NOT NULL DEFAULT 0;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS cta_click_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION increment_page_view(p_slug text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE landing_pages
     SET view_count = view_count + 1
   WHERE slug = p_slug
     AND status = 'published';
$$;

CREATE OR REPLACE FUNCTION increment_page_cta_click(p_slug text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE landing_pages
     SET cta_click_count = cta_click_count + 1
   WHERE slug = p_slug
     AND status = 'published';
$$;

-- Reload PostgREST's schema cache so the new columns/functions are visible
-- immediately (functions must be re-exposed too, otherwise .rpc() 404s).
NOTIFY pgrst, 'reload schema';
