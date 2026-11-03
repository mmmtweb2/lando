-- 044: one SUMIT PaymentID may settle ONE thing, across one-time payments AND subscription events.
--
-- Today uniqueness is per table: payments has a partial unique index on sumit_payment_id for
-- settled rows (010) and seo_subscription_events has one of its own (030). Nothing stops the SAME
-- SUMIT payment from settling a one-time purchase AND activating a subscription (or vice versa).
-- A single constraint cannot span two tables, so this adds a registry whose PRIMARY KEY is the
-- global unique constraint, and two triggers that claim into it automatically. No application
-- change is needed for the database to enforce it; a clash raises 23505 (unique_violation), which
-- the application already treats as "not granted / needs review".
--
--   payments                  claims on INSERT/UPDATE when sumit_payment_id IS NOT NULL and
--                             status IN ('paid','processing')  (rows that merely RECORD an offered
--                             id while failing verification, e.g. needs_review, claim nothing)
--   seo_subscription_events   claims on INSERT when sumit_payment_id IS NOT NULL
--
-- A claim is never released: an id that once settled something stays spent, even if the row later
-- moves to needs_review. The SAME row may re-claim its own id (admin re-verify, processing->paid).
--
-- Re-runnable, and DEDUPE-SAFE: the backfill uses ON CONFLICT DO NOTHING and reports clashes
-- instead of failing. Existing data that already shares an id across the two tables (the very
-- double-settlement this prevents) is left exactly as it is; the OLDEST claimant keeps the id in
-- the registry and the rest are listed in a NOTICE for a human to review. Nothing is deleted.
-- Tables that do not exist yet (migrations 008 / 030 not run) are skipped.
-- Security: RLS ENABLE + FORCE, zero policies (backend service role only).

CREATE TABLE IF NOT EXISTS sumit_payment_claims (
  sumit_payment_id  TEXT        PRIMARY KEY,
  source            TEXT        NOT NULL CHECK (source IN ('payment', 'subscription_event')),
  ref_id            TEXT        NOT NULL,
  claimed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sumit_payment_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE sumit_payment_claims FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION sumit_claim_payment_id() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  src TEXT := TG_ARGV[0];
  inserted INT;
BEGIN
  IF NEW.sumit_payment_id IS NULL OR btrim(NEW.sumit_payment_id) = '' THEN
    RETURN NEW;
  END IF;
  IF src = 'payment' THEN   -- (nested on purpose: seo_subscription_events has no `status` column)
    IF NEW.status NOT IN ('paid', 'processing') THEN
      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO sumit_payment_claims (sumit_payment_id, source, ref_id)
  VALUES (NEW.sumit_payment_id, src, NEW.id::text)
  ON CONFLICT (sumit_payment_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;

  IF inserted = 0 THEN
    -- already claimed: fine only if it is claimed by THIS very row
    PERFORM 1 FROM sumit_payment_claims
     WHERE sumit_payment_id = NEW.sumit_payment_id AND source = src AND ref_id = NEW.id::text;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SUMIT payment id % has already settled another payment or subscription', NEW.sumit_payment_id
        USING ERRCODE = 'unique_violation', CONSTRAINT = 'sumit_payment_claims_pkey';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

DO $$
DECLARE
  n_pay bigint := 0;
  n_ev  bigint := 0;
  clashes bigint := 0;
BEGIN
  IF to_regclass('public.payments') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_payments_claim_sumit_id ON public.payments;
    CREATE TRIGGER trg_payments_claim_sumit_id
      BEFORE INSERT OR UPDATE OF sumit_payment_id, status ON public.payments
      FOR EACH ROW EXECUTE FUNCTION sumit_claim_payment_id('payment');

    INSERT INTO sumit_payment_claims (sumit_payment_id, source, ref_id, claimed_at)
    SELECT sumit_payment_id, 'payment', id::text, COALESCE(paid_at, created_at, now())
    FROM public.payments
    WHERE sumit_payment_id IS NOT NULL AND btrim(sumit_payment_id) <> '' AND status IN ('paid', 'processing')
    ORDER BY COALESCE(paid_at, created_at, now())
    ON CONFLICT (sumit_payment_id) DO NOTHING;
    GET DIAGNOSTICS n_pay = ROW_COUNT;
  ELSE
    RAISE NOTICE '044: payments table missing - skipped';
  END IF;

  IF to_regclass('public.seo_subscription_events') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_seo_sub_events_claim_sumit_id ON public.seo_subscription_events;
    CREATE TRIGGER trg_seo_sub_events_claim_sumit_id
      BEFORE INSERT ON public.seo_subscription_events
      FOR EACH ROW EXECUTE FUNCTION sumit_claim_payment_id('subscription_event');

    INSERT INTO sumit_payment_claims (sumit_payment_id, source, ref_id, claimed_at)
    SELECT sumit_payment_id, 'subscription_event', id::text, created_at
    FROM public.seo_subscription_events
    WHERE sumit_payment_id IS NOT NULL AND btrim(sumit_payment_id) <> ''
    ORDER BY created_at
    ON CONFLICT (sumit_payment_id) DO NOTHING;
    GET DIAGNOSTICS n_ev = ROW_COUNT;
  ELSE
    RAISE NOTICE '044: seo_subscription_events table missing - skipped';
  END IF;

  -- Report (never fix) ids that were ALREADY shared before this migration: they are claimed by one
  -- row in the registry, the other claimant(s) keep working but cannot move again.
  IF to_regclass('public.payments') IS NOT NULL AND to_regclass('public.seo_subscription_events') IS NOT NULL THEN
    SELECT count(*) INTO clashes
    FROM public.payments p
    JOIN public.seo_subscription_events e ON e.sumit_payment_id = p.sumit_payment_id
    WHERE p.status IN ('paid', 'processing');
    IF clashes > 0 THEN
      RAISE NOTICE '044: % SUMIT payment id(s) were already used by BOTH a one-time payment and a subscription event - review: SELECT p.id, e.id, p.sumit_payment_id FROM payments p JOIN seo_subscription_events e USING (sumit_payment_id) WHERE p.status IN (''paid'',''processing'')', clashes;
    END IF;
  END IF;
  RAISE NOTICE '044: registry backfilled (% payments, % subscription events)', n_pay, n_ev;
END $$;
