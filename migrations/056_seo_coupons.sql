-- 056: discount coupons for the Google-promotion subscription (README part 148).
--
--   coupons.applicable_purposes  may now also hold 'seo_monthly' and 'seo_annual'. A coupon applies to the
--                                subscription ONLY when one of these is listed explicitly: an empty/NULL list
--                                ("any purpose") still means any landing-page purchase, never the subscription.
--   coupons.seo_duration         'first'   = only the first payment of the subscription is discounted (default)
--                                'forever' = every payment: the standing order is created at the discounted
--                                            amount. On the annual plan (one payment, no auto-renewal) this has
--                                            no effect beyond the first payment.
--   seo_subscriptions.coupon_id        the coupon that priced the current checkout (NULL = none)
--   seo_subscriptions.recurring_amount what the standing order charges each month (NULL = same as `amount`,
--                                      i.e. the list price, or the SEO_TEST_PRICE of a test account)
--   seo_subscriptions.discount_amount  the ₪ taken off the first payment (accounting; the list price is the plan's)
--
-- The subscription never writes a `payments` row (it has its own seo_subscription_events), so the coupon is
-- recorded on the subscription and in coupon_redemptions (payment_id NULL), not on payments.coupon_id.
-- `seo_subscriptions.amount` keeps its meaning "what the next payment must cover": it is the discounted
-- checkout price until the first payment is verified, then the server moves it to recurring_amount.
--
-- Counting discipline is unchanged from 014: redemptions_count moves by compare-and-swap when the checkout
-- OPENS. Re-opening the checkout of the same still-unpaid subscription with the same code does not count again.
--
-- Security: RLS on both tables is already ENABLE + FORCE with zero policies (014, 030); nothing changes.
-- Safe to re-run; no rows are changed or deleted. The code works before this has run: subscription coupons are
-- simply unavailable ("הקוד לא תקף") and landing-page coupons work as before.

-- 1. Widen any CHECK on coupons.applicable_purposes (014 created none; drop whatever exists by any name),
--    then add the widened one. NOT VALID: existing rows are not re-checked, only new writes.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public' AND rel.relname = 'coupons' AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%applicable_purposes%'
  LOOP
    EXECUTE format('ALTER TABLE public.coupons DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.coupons ADD CONSTRAINT coupons_applicable_purposes_check
  CHECK (applicable_purposes IS NULL
         OR applicable_purposes <@ ARRAY['publish','renew','credits','bundle','seo_monthly','seo_annual']::text[])
  NOT VALID;

-- 2. How long a subscription coupon lasts.
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS seo_duration text NOT NULL DEFAULT 'first';
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_seo_duration_check;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_seo_duration_check CHECK (seo_duration IN ('first', 'forever'));

-- 3. The subscription remembers its coupon and what the standing order charges.
ALTER TABLE public.seo_subscriptions ADD COLUMN IF NOT EXISTS coupon_id uuid NULL REFERENCES public.coupons (id) ON DELETE SET NULL;
ALTER TABLE public.seo_subscriptions ADD COLUMN IF NOT EXISTS recurring_amount numeric(10,2) NULL;
ALTER TABLE public.seo_subscriptions ADD COLUMN IF NOT EXISTS discount_amount numeric(10,2) NULL;
ALTER TABLE public.seo_subscriptions DROP CONSTRAINT IF EXISTS seo_subscriptions_recurring_amount_check;
ALTER TABLE public.seo_subscriptions ADD CONSTRAINT seo_subscriptions_recurring_amount_check
  CHECK (recurring_amount IS NULL OR recurring_amount > 0);
CREATE INDEX IF NOT EXISTS idx_seo_subscriptions_coupon ON public.seo_subscriptions (coupon_id) WHERE coupon_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
