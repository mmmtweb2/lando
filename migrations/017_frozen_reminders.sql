-- ─────────────────────────────────────────────────────────────────────────────
-- 017_frozen_reminders.sql — mid-freeze renewal reminders before hard-delete
--                             (run in the Supabase SQL editor, same as 009-016)
--
-- ── The problem this closes ──────────────────────────────────────────────────
-- The renewal lifecycle (013_renewal_lifecycle.sql, renewal.service.ts) sends
-- ONE "frozen" email the moment a page freezes, then goes completely silent for
-- up to FROZEN_RETENTION_MONTHS (12) before hardDeleteFrozenPages permanently
-- deletes the page AND its lead history. A customer who misses that single
-- email — busy, on vacation, spam-filtered, whatever — gets zero further
-- warning before irreversible data loss.
--
-- Fix (src/services/renewal.service.ts, renewal.mailer.ts): two additional
-- reminder emails during the frozen period — a friendly 6-month check-in and an
-- explicit 11-month "last chance, this is about to be permanently deleted"
-- notice — using the exact same de-dup / at-least-once send discipline as the
-- existing T-30/T-7/T-0 pre-expiry reminders.
--
-- ── This migration ───────────────────────────────────────────────────────────
-- Two nullable timestamp columns, same shape and purpose as the existing
-- `renewal_reminder_{30,7,0}_at` columns: NULL = not sent yet, a timestamp =
-- exactly when it was sent (so support can answer "did we warn this customer,
-- and when" — the same question these existed to answer before). Cleared to
-- NULL on every renewal (see grantRenewal in renewal.service.ts) so a page that
-- freezes again in a future year gets its own fresh set of frozen-stage
-- reminders rather than inheriting stale send timestamps from a prior freeze.
--
-- SAFE / RE-RUNNABLE: `IF NOT EXISTS`, additive only, changes no existing data.
-- A page that is already, say, 8 months frozen when this ships will correctly
-- receive its (late) 6-month reminder on the next sweep — the sweep's queries
-- use `<=` (at-or-past threshold), matching the existing at-least-once-not-zero
-- philosophy for the pre-existing reminders.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS frozen_reminder_6mo_at  TIMESTAMPTZ;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS frozen_reminder_11mo_at TIMESTAMPTZ;

-- Reload PostgREST's schema cache so the new columns are visible immediately.
NOTIFY pgrst, 'reload schema';
