-- 046: plan catalog columns on seo_subscriptions (task #30, docs/billing-spec.md).
--
-- A subscription now records WHICH plan it is (monthly / monthly_page / annual / annual_page), its
-- cycle (month = standing order, year = one single payment, no auto-renew) and whether it carries
-- the landing-page add-on. Existing rows are monthly plans without a page, which is what they are.
-- reminder_for_period_end remembers the period end an annual "your year is ending" email was sent
-- for, so the reminder goes out once per period and never twice.
-- Re-runnable. No new table, so no RLS change (seo_subscriptions already has RLS ENABLE + FORCE).

ALTER TABLE seo_subscriptions ADD COLUMN IF NOT EXISTS plan_id TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE seo_subscriptions ADD COLUMN IF NOT EXISTS cycle TEXT NOT NULL DEFAULT 'month';
ALTER TABLE seo_subscriptions ADD COLUMN IF NOT EXISTS with_page BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE seo_subscriptions ADD COLUMN IF NOT EXISTS reminder_for_period_end TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE seo_subscriptions ADD CONSTRAINT seo_subscriptions_cycle_check CHECK (cycle IN ('month', 'year'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE seo_subscriptions ADD CONSTRAINT seo_subscriptions_plan_check
    CHECK (plan_id IN ('monthly', 'monthly_page', 'annual', 'annual_page'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
