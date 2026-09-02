-- ─────────────────────────────────────────────────────────────────────────────
-- 013_renewal_lifecycle.sql — annual page renewal: reminders, grace, freeze,
--                             frozen retention, hard delete
--                             (run in the Supabase SQL editor, same as 009-012)
--
-- ── The problem this closes ──────────────────────────────────────────────────
-- Publishing a page has always set `expires_at = published_at + 1 year`
-- (publishPageById in src/controllers/landing.controller.ts), but NOTHING ever
-- read that column. A page's expiry came and went with no email, no state
-- change and no way to pay for another year — while the marketing site has been
-- promising "חידוש שנתי — 99 ₪ בלבד" the whole time. This migration adds the
-- columns the lifecycle needs; the logic lives in src/services/renewal.service.ts.
--
-- ── The lifecycle ────────────────────────────────────────────────────────────
--   T-30d  reminder email #1   (page stays live)
--   T-7d   reminder email #2   (page stays live)
--   T-0    reminder email #3   (page stays live — expiry day)
--   T+0..7 GRACE PERIOD        (page stays fully live and public, as normal)
--   T+7d   FREEZE              status → 'frozen', frozen_at = now().
--                              Page goes offline to the public but is NOT
--                              deleted and NOT edited. Owner can pay 99₪ to
--                              restore it (purpose 'renew' in payment.controller).
--   +12mo  HARD DELETE         after 12 months frozen with no renewal, the page
--                              AND its leads rows are deleted, permanently.
--
-- ── Why `status = 'frozen'` needs no constraint change ───────────────────────
-- `landing_pages.status` is a plain `VARCHAR DEFAULT 'draft'` with NO CHECK
-- constraint and no enum type (see 006_consolidate_schema.sql). 'frozen' is
-- therefore just a new string value — nothing to alter. The three values the
-- application uses are now: 'draft' | 'published' | 'frozen'.
--
-- ── SAFETY / RE-RUNNABILITY ──────────────────────────────────────────────────
-- Every statement is `IF NOT EXISTS`. This file adds columns and indexes only —
-- it changes NO existing row's data and freezes/deletes nothing. The first
-- actual freeze happens when the sweep in src/index.ts runs against pages whose
-- grace period has genuinely elapsed.
--
-- ⚠️ DEPLOY ORDER: run this file BEFORE deploying the code. The sweep writes
-- these columns on its first pass (~30s after boot) and would otherwise error.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Lifecycle columns on landing_pages
-- ─────────────────────────────────────────────────────────────────────────────

-- When the page was frozen (grace period elapsed with no renewal). NULL for
-- every page that is not currently frozen. Also the clock the 12-month
-- retention window is measured from, so it MUST be cleared on renewal.
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ;

-- Reminder de-duplication. One nullable timestamp per threshold, recording when
-- that reminder was actually sent. NULL = not sent yet. Timestamps rather than
-- booleans so support can answer "did we actually warn this customer, and when?"
-- — the single most likely question when a customer disputes a freeze.
--
-- These are reset to NULL on every renewal: the next annual cycle needs its own
-- fresh set of three reminders.
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS renewal_reminder_30_at TIMESTAMPTZ;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS renewal_reminder_7_at  TIMESTAMPTZ;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS renewal_reminder_0_at  TIMESTAMPTZ;

-- Renewal history. `renewal_count` is 0 for a page that has only ever been
-- published once; it increments on each paid 99₪ renewal. Cheap, and it is the
-- only record that a renewal ever happened once expires_at has moved on.
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS renewed_at    TIMESTAMPTZ;
ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS renewal_count INTEGER NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Indexes for the sweep
-- ─────────────────────────────────────────────────────────────────────────────
-- The sweep runs every 6 hours and issues one query per lifecycle stage. Each is
-- a range scan on a timestamp filtered by status, so both columns are indexed
-- together. Without these, every sweep is a full table scan of landing_pages —
-- fine at today's size, not fine later, and this is the cheap moment to add them.

CREATE INDEX IF NOT EXISTS idx_landing_pages_status_expires_at
    ON landing_pages (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_landing_pages_status_frozen_at
    ON landing_pages (status, frozen_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. NOT DONE HERE, deliberately: leads FK ON DELETE CASCADE
-- ─────────────────────────────────────────────────────────────────────────────
-- `leads_landing_page_id_fkey` has NO ON DELETE clause (006_consolidate_schema.sql),
-- so it defaults to NO ACTION: deleting a landing_pages row that still has leads
-- raises a foreign-key violation.
--
-- The tempting fix is `ON DELETE CASCADE`. It is NOT applied, on purpose:
-- cascading would make DELETE /api/landing/:id — a one-click button in the
-- dashboard — silently destroy a customer's entire lead history as a side effect
-- of removing a page. Leads are the product's actual output; that deletion must
-- stay explicit and visible in application code.
--
-- Instead, the hard-delete path in src/services/renewal.service.ts deletes the
-- page's leads FIRST and the page SECOND, in that order, and treats a failure to
-- delete the leads as a hard stop (the page is left frozen and retried next
-- sweep) rather than orphaning anything. The FK is left as the safety net that
-- makes getting this wrong an error instead of silent data loss.
