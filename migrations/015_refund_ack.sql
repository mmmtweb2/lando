-- ─────────────────────────────────────────────────────────────────────────────
-- 015_refund_ack.sql — server-side proof of the refund/no-refund disclosure
--                      (run in the Supabase SQL editor, same as 009-014)
--
-- ── Why ───────────────────────────────────────────────────────────────────
-- RefundAck (client/src/components/RefundAck.tsx) shows the required
-- refund/no-refund disclosure and requires the customer to check it before
-- the pay button is enabled — but until now that checked state lived only in
-- React useState and was never sent to or stored by the backend. In a real
-- chargeback dispute there was no server-side record that a specific
-- customer actually saw and acknowledged the disclosure for a specific
-- payment; the client-side disabled button proves nothing to a card network.
--
-- startPayment (src/controllers/payment.controller.ts) now rejects the
-- request with 400 unless the client explicitly sends refundAck === true,
-- and stamps these two columns on the payments row it inserts.
--
-- ── SAFETY / RE-RUNNABILITY ─────────────────────────────────────────────────
-- IF NOT EXISTS column adds, defaulted so existing rows aren't broken.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS refund_ack    boolean NOT NULL DEFAULT false;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS refund_ack_at timestamptz;

-- PostgREST caches the schema — without this the app can't see the new
-- columns until the API restarts (same gotcha as migration 009).
NOTIFY pgrst, 'reload schema';
