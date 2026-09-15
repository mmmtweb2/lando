-- ─────────────────────────────────────────────────────────────────────────────
-- 021_site_visits.sql — event-level traffic log for the MARKETING site (v1)
--                         (run in the Supabase SQL editor, same as 009-020)
--
-- ── What this is ──────────────────────────────────────────────────────────
-- Migration 019 added two counters on `landing_pages` for GENERATED pages
-- (an owner's own published page), and explicitly anticipated a future
-- "fuller event-level table" as a natural extension. This is that
-- extension — but scoped to a different surface: traffic on pagey.co.il's
-- own MARKETING site (home page, pricing, etc.), requested 2026-09-15 to
-- give the founder a real traffic dashboard with source breakdown, not
-- just anecdotal WhatsApp-status view counts.
--
-- One row per page view. Deliberately minimal: no user-agent parsing, no
-- geo lookup, no session stitching beyond a client-generated visitor id.
--
-- ── Security ───────────────────────────────────────────────────────────────
-- RLS ENABLE + FORCE, zero policies — same deny-all-by-default pattern as
-- every other table in this schema. All reads/writes happen through the
-- Express backend using the service-role key, which bypasses RLS by
-- design; RLS here is defense-in-depth only, in case that key ever leaks.
--
-- Insert path is a PUBLIC unauthenticated route (any visitor's browser can
-- POST a page view), so unlike most tables here this one intentionally
-- accepts writes from untrusted traffic — the Express layer is responsible
-- for rate-limiting and basic validation, exactly as landing.routes.ts's
-- `trackLimiter` already does for migration 019's view/click counters.
--
-- SAFE / RE-RUNNABLE: `CREATE TABLE IF NOT EXISTS`, additive only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS site_visits (
  id           bigserial PRIMARY KEY,
  path         text        NOT NULL,
  referrer     text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  visitor_id   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_visits_created_at_idx ON site_visits (created_at);
CREATE INDEX IF NOT EXISTS site_visits_visitor_id_idx  ON site_visits (visitor_id);

ALTER TABLE site_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_visits FORCE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
