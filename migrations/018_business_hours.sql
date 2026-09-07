-- ─────────────────────────────────────────────────────────────────────────────
-- 018_business_hours.sql — business-hours field for local-business trust content
--                           (run in the Supabase SQL editor, same as 009-017)
--
-- ── The problem this closes ──────────────────────────────────────────────────
-- Flagged in the part-16 audit round as the single highest-leverage gap for the
-- local-business / walk-in segment (bakeries, salons, clinics): a business
-- owner has no way to tell visitors WHEN they're open, and the generated page
-- has never rendered an hours/location section at all. `address` already
-- existed as a column (002_add_contact_fields.sql) and flows through the AI
-- prompt and renderer, but the Wizard never actually collected it — this
-- migration adds the missing hours column so the Wizard/renderer round can
-- ship both together.
--
-- ── This migration ───────────────────────────────────────────────────────────
-- One nullable free-text column. Deliberately NOT a structured per-day
-- open/close schema — the business owner types hours as free text (e.g.
-- "א'-ה' 9:00-19:00, ו' 9:00-14:00") and it is rendered/copied verbatim,
-- matching NO_FABRICATION_RULE / USE_PROVIDED_SPECIFICS_RULE: Pagey never
-- invents or reformats a fact the business didn't state.
--
-- SAFE / RE-RUNNABLE: `IF NOT EXISTS`, additive only, changes no existing data.
-- Existing pages simply have NULL business_hours until the owner edits/
-- regenerates — the renderer treats an empty value as "section not shown".
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE landing_pages ADD COLUMN IF NOT EXISTS business_hours TEXT;

-- Reload PostgREST's schema cache so the new column is visible immediately.
NOTIFY pgrst, 'reload schema';
