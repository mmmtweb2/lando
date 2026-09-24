-- ─────────────────────────────────────────────────────────────────────────────
-- 022_funnel_events.sql — signup/wizard/purchase funnel event log (v1)
--                          (run in the Supabase SQL editor, same as 009-021)
--
-- ── Why this exists ───────────────────────────────────────────────────────
-- Migration 021 gave a top-of-funnel view (site traffic). One week post-launch,
-- Moshe had real traffic (~350 views/30 days) but almost no signups and 0
-- purchases, with no way to tell WHERE in the funnel people drop off — landing
-- page → signup → wizard → page created → checkout → paid. This table closes
-- that gap: one row per meaningful funnel step, so the admin dashboard can
-- show a real step-by-step drop-off instead of just top/bottom numbers.
--
-- Events logged here (both client- and server-fired — see README part 34):
--   signup_attempt, signup_completed, wizard_started, wizard_step_reached,
--   page_created, checkout_started, page_published, purchase_completed
--
-- Deliberately a generic (event_name, meta jsonb) shape rather than one column
-- per event type — new funnel steps can be added later without a migration.
--
-- ── Security ───────────────────────────────────────────────────────────────
-- Same pattern as site_visits (021): RLS ENABLE + FORCE, zero policies,
-- deny-all by default. Reached from BOTH a public unauthenticated route
-- (client-fired intent events) and authenticated backend code paths
-- (server-fired completion events) — always through the service-role key,
-- which bypasses RLS by design.
--
-- SAFE / RE-RUNNABLE: `CREATE TABLE IF NOT EXISTS`, additive only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS funnel_events (
  id           bigserial PRIMARY KEY,
  event_name   text        NOT NULL,
  visitor_id   text,
  user_email   text,
  meta         jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funnel_events_created_at_idx ON funnel_events (created_at);
CREATE INDEX IF NOT EXISTS funnel_events_event_name_idx ON funnel_events (event_name);

ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_events FORCE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
