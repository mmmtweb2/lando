-- ─────────────────────────────────────────────────────────────────────────────
-- 012_page_bundles.sql — one-time page bundles replace yearly subscriptions
--                        (run in the Supabase SQL editor, same as 009/010/011)
--
-- Moshe's pricing decision, 2026-09-01: the `freelancer` (1,490₪/yr) and
-- `agency` (3,990₪/yr) subscription plans are withdrawn and replaced by
-- one-time, never-expiring PAGE BUNDLES. A single page stays 249₪ one-time,
-- exactly as before. See src/config/billing.ts for the full model.
--
--   חבילת 5 דפים  —   930₪ →  5 page credits
--   חבילת 10 דפים — 1,250₪ → 10 page credits + permanent white-label
--
-- Publishing a page costs one page credit, whichever way it was bought. There
-- is no "active plan" any more: no plan_expires_at check, no maxActivePages
-- slot arithmetic, no monthly refill.
--
-- This file does two things: (1) add the columns, (2) grandfather every
-- customer who is TODAY holding an active, unexpired paid plan so nobody who
-- paid real money loses access the moment this deploys.
--
-- SAFETY / RE-RUNNABILITY: every statement is idempotent. The data migration in
-- part 2 only touches rows with `page_credits_total = 0`, i.e. rows that have
-- never been granted anything — since this migration is the first thing that
-- ever writes that column, running the file twice cannot double-grant.
--
-- The legacy `plan`, `plan_expires_at` columns are deliberately NOT dropped:
-- they are the only record of what each grandfathered customer originally
-- bought, and dropping them is irreversible. Application code stops reading
-- them entirely (billing.service.ts); they can be dropped in a later cleanup
-- once the conversion has been reviewed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Part 1: schema ──────────────────────────────────────────────────────────

-- Page-publish balance. +N on purchase, -1 per published page. Never expires.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS page_credits       INTEGER NOT NULL DEFAULT 0;

-- Lifetime page credits ever granted; never decreases. Used only as the durable
-- "has this account ever paid?" signal that picks the monthly page-CREATION cap
-- (free tier 5/month, page-bundle buyers 60/month). Spending your last page
-- credit must not silently demote you back to the free tier's cap.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS page_credits_total INTEGER NOT NULL DEFAULT 0;

-- Permanent white-label perk (hides the "נוצר באמצעות Pagey" badge and the
-- "| Pagey" title suffix). Granted by the 10-page bundle and never revoked.
-- Previously this was DERIVED at read time from an active agency subscription,
-- so it lapsed with the plan; under a one-time purchase there is nothing to
-- lapse, hence a stored flag.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS white_label        BOOLEAN NOT NULL DEFAULT FALSE;

-- Balance lookups happen on every publish attempt and every dashboard load.
CREATE INDEX IF NOT EXISTS idx_user_profiles_page_credits ON user_profiles (page_credits);

-- ─── Part 2: grandfather existing active subscribers ─────────────────────────
--
-- CONVERSION (spelled out so it can be checked by hand before running):
--
--   active freelancer → page_credits += 10,  white_label unchanged (false)
--   active agency     → page_credits += 40,  white_label := TRUE
--
-- "Active" = plan is freelancer/agency AND plan_expires_at is in the future.
-- Lapsed plans get nothing: they confer no entitlement today either, so nothing
-- is being taken away from them.
--
-- WHY THE FULL maxActivePages, NOT THE UNUSED REMAINDER:
-- the numbers 10 and 40 are the old plans' `maxActivePages`. A customer who has
-- already published all 10 of their freelancer pages therefore comes out of this
-- with those 10 pages still live (page expiry is untouched by this change) PLUS
-- 10 fresh page credits — more than they strictly hold right now. That is
-- deliberate and generous, for three reasons: under the old model their slots
-- kept recycling for the rest of the paid term, so granting only the unused
-- remainder would take real value away; the population is tiny (a handful of
-- rows at most); and the alternative — netting off currently-published pages —
-- is the version that can under-deliver on something already paid for. Same
-- philosophy as the plan-proration carry-forward already in the codebase:
-- when in doubt, err toward the customer, exactly and auditably.
--
-- WHY FREELANCER DOES NOT GET WHITE-LABEL:
-- under the new rules white-label is the 10-page bundle's bonus. Freelancer
-- never included it, so withholding it takes nothing away from anyone; agency
-- DID include it and it is a paid-for perk, so it is preserved permanently.
-- (This is the "be consistent with the new rules unless it would harm an
-- existing paying customer" rule applied in both directions.)
--
-- AI credits: intentionally NOT topped up here. The old plans' `monthlyCredits`
-- were a subscription refill with no one-time equivalent, these customers keep
-- whatever `credits` balance they already have, and minting credits into live
-- accounts is a business decision for Moshe, not a side effect of a migration.

UPDATE user_profiles
SET
  page_credits = page_credits + CASE plan WHEN 'freelancer' THEN 10 WHEN 'agency' THEN 40 END,
  page_credits_total = page_credits_total + CASE plan WHEN 'freelancer' THEN 10 WHEN 'agency' THEN 40 END,
  white_label = white_label OR (plan = 'agency')
WHERE plan IN ('freelancer', 'agency')
  AND plan_expires_at IS NOT NULL
  AND plan_expires_at > NOW()
  AND page_credits_total = 0;   -- re-run guard: only rows never granted before

-- Sanity check to run by hand AFTER the update (should list every converted
-- customer, and nothing else):
--   select email, plan, plan_expires_at, page_credits, page_credits_total, white_label
--   from public.user_profiles
--   where plan in ('freelancer','agency') and plan_expires_at > now();

-- PostgREST caches the table schema; a missing reload is exactly what silently
-- broke plan activation after migration 009 (see README, part 4/5). Reload it so
-- the new columns are visible to the app immediately.
NOTIFY pgrst, 'reload schema';
