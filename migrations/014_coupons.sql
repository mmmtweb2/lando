-- ─────────────────────────────────────────────────────────────────────────────
-- 014_coupons.sql — discount codes (coupons) on every paid purpose
--                   (run in the Supabase SQL editor, same as 009-013)
--
-- ── What this adds, and why ──────────────────────────────────────────────────
-- Moshe's request: a coupon system that gives a discount on price, managed from
-- the admin dashboard ("Instagram launch promo", an affiliate's code, a
-- one-off apology discount for a customer). Until now every price in the
-- product came straight from src/config/billing.ts with no way to move it short
-- of a code deploy.
--
-- A coupon reduces the ₪ amount of ONE payment, at the moment the SUMIT
-- checkout is opened (startPayment in src/controllers/payment.controller.ts).
-- It grants nothing by itself: what the customer receives is still decided
-- entirely by `payments.purpose` on the verified return, exactly as before.
-- The discount is therefore a pure price change and cannot become a way to
-- mint page credits, AI credits or white-label.
--
-- ── The three tables/columns ─────────────────────────────────────────────────
--   coupons              the code itself + its rules (who/what/when/how many)
--   coupon_redemptions   audit trail, and the per-user cap's source of data
--   payments.coupon_id   which coupon (if any) priced this payment, and by how
--   payments.discount_amount   much — kept per-payment for accounting, because
--                        `payments.amount` records what was CHARGED and there
--                        would otherwise be no record of the list price.
--
-- ── Counting discipline (the one thing to not "fix" later) ───────────────────
-- `redemptions_count` is incremented when the CHECKOUT OPENS, not when the
-- payment is verified as paid. That is deliberate: it is what makes the global
-- `max_redemptions` cap airtight against two concurrent checkouts racing for
-- the last use of a limited coupon (the application does a compare-and-swap on
-- this exact column — same pattern as addCredits in credits.service.ts and the
-- payment claim in paymentReturn). The accepted cost is that an abandoned
-- checkout still consumes one use. See the comment at the redemption site in
-- payment.controller.ts before changing this.
--
-- ── SAFETY / RE-RUNNABILITY ──────────────────────────────────────────────────
-- Every statement is IF NOT EXISTS. These are brand-new tables and two new
-- nullable columns: no existing row is read, changed or deleted, and with no
-- coupons defined the whole feature is inert. Deploy order does not matter for
-- correctness, but run this BEFORE the code so the first coupon lookup does not
-- hit a missing table.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. coupons ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.coupons (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),

  -- Always stored UPPERCASE and looked up on the normalized (uppercased,
  -- trimmed) form, so "launch10", "Launch10" and " LAUNCH10 " are one coupon
  -- and not three. UNIQUE is what makes that guarantee real rather than a
  -- convention the application is trusted to keep.
  code                text NOT NULL UNIQUE,

  discount_type       text NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  -- percent → 1-100 (whole or fractional percent off), fixed → ₪ off.
  -- Both are re-validated in the API before insert; the CHECK is the floor that
  -- a hand-written SQL insert cannot get below.
  discount_value      numeric NOT NULL CHECK (discount_value > 0),

  -- NULL or empty = valid for any purpose. Otherwise a subset of
  -- 'publish' | 'renew' | 'credits' | 'bundle' (payments.purpose). A text[]
  -- rather than a join table: the set is tiny, closed, and only ever read whole.
  applicable_purposes text[],

  -- Global cap. NULL = unlimited.
  max_redemptions     integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  -- System-owned. Incremented by compare-and-swap when a checkout opens; never
  -- editable from the admin API (see PATCH /api/admin/coupons/:id).
  redemptions_count   integer NOT NULL DEFAULT 0,

  -- Per-customer cap. NULL = unlimited. The API defaults this to 1 when the
  -- admin does not specify one: an uncapped-per-user coupon is almost never
  -- what someone means, and it is the mistake that costs real money.
  max_per_user        integer CHECK (max_per_user IS NULL OR max_per_user > 0),

  -- The admin's on/off switch, deliberately independent of expiry and of the
  -- redemption cap: a coupon can be paused and resumed without touching either.
  -- This is also the "delete" the admin UI exposes — a coupon that has priced a
  -- real payment must never actually be deleted (see part 4).
  active              boolean NOT NULL DEFAULT true,
  expires_at          timestamptz,

  created_by          text,   -- admin email, for "who made this code?"
  -- Admin-internal label ("Instagram launch promo"). NEVER shown to a customer.
  notes               text
);

-- Every validate-coupon and every discounted checkout is a lookup by code.
-- UNIQUE already provides the index; this is the case-insensitivity safety net
-- for any lookup that reaches the table with a non-normalized code.
CREATE INDEX IF NOT EXISTS coupons_code_upper_idx ON public.coupons (UPPER(code));

-- ─── 2. coupon_redemptions ───────────────────────────────────────────────────
-- One row per coupon use. Two jobs: the audit trail ("who used this code, on
-- which payment, when"), and the data behind the per-user cap.
--
-- The audit row is written right after the counter CAS succeeds. If the insert
-- fails the checkout still proceeds and the failure is logged loudly: the
-- counter, not this table, is the source of truth for the global cap.

CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id    uuid NOT NULL REFERENCES public.coupons (id),
  user_email   text NOT NULL,
  -- Nullable so a redemption is never lost just because the payment row it
  -- belongs to could not be written; in practice it is always set.
  payment_id   uuid REFERENCES public.payments (id),
  redeemed_at  timestamptz NOT NULL DEFAULT now()
);

-- The per-user cap check is exactly this composite lookup, on every checkout
-- that carries a coupon.
CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_user_idx
    ON public.coupon_redemptions (coupon_id, lower(user_email));

CREATE INDEX IF NOT EXISTS coupon_redemptions_payment_idx
    ON public.coupon_redemptions (payment_id);

-- ─── 3. payments: which coupon priced this charge, and by how much ───────────
-- Both nullable — the overwhelming majority of payments carry no coupon, and a
-- backfill would be meaningless for the ones that predate this file.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS coupon_id       uuid REFERENCES public.coupons (id);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS discount_amount numeric;

CREATE INDEX IF NOT EXISTS payments_coupon_id_idx ON public.payments (coupon_id);

-- ─── 4. RLS ──────────────────────────────────────────────────────────────────
-- Same lockdown as payments (008) and the 007 RLS work: the backend uses the
-- service_role key (which bypasses RLS) and the browser never touches these
-- tables directly — it only ever sees a coupon through
-- POST /api/payments/validate-coupon, which returns the discount shape and
-- nothing else. RLS enabled with no policies denies anon/authenticated
-- outright, so the anon key cannot enumerate unused promo codes.
ALTER TABLE public.coupons            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons            FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions FORCE  ROW LEVEL SECURITY;

-- NOTE: no ON DELETE clause on either FK above, on purpose — same reasoning as
-- the leads FK in 013. A coupon that has priced a real payment is part of that
-- payment's accounting record; deleting it must raise a foreign-key error, not
-- quietly rewrite history. The admin "delete" is `active = false`, and there is
-- deliberately no DELETE endpoint.

-- PostgREST caches the schema — without this the app sees neither the new
-- tables nor the new payments columns until the API restarts (this is exactly
-- what silently broke plan activation after migration 009).
NOTIFY pgrst, 'reload schema';
