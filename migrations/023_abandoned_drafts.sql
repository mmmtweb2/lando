-- ─────────────────────────────────────────────────────────────────────────────
-- 023_abandoned_drafts.sql — abandoned-draft reminders + cleanup
--                            (run in the Supabase SQL editor, same as 009-022)
--
-- Drafts (status = 'draft') that are never published used to live forever.
-- New lifecycle (src/services/draftCleanup.service.ts), measured from
-- `draft_clock_at`:
--   day 1   friendly reminder
--   day 7   second reminder
--   day 30  final warning ("deleted in 7 days")
--   day 37  delete the draft (leads first, then the page)
--
-- `draft_clock_at` is ADDED WITH DEFAULT NOW(): every EXISTING row is stamped
-- with the moment this migration runs (so existing drafts get a fresh clock
-- starting from go-live, as agreed), and every NEW row is stamped at creation.
-- It is only ever read for status = 'draft' rows.
--
-- The three *_at columns follow the same NULL = not sent / timestamp = sent
-- convention as the renewal reminder columns (013, 017).
--
-- SAFE / RE-RUNNABLE: IF NOT EXISTS, additive only.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS draft_clock_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS draft_reminder_1d_at  TIMESTAMPTZ;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS draft_reminder_7d_at  TIMESTAMPTZ;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS draft_warning_30d_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_landing_pages_draft_clock
  ON landing_pages (draft_clock_at) WHERE status = 'draft';

NOTIFY pgrst, 'reload schema';
