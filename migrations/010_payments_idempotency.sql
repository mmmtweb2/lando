-- ─────────────────────────────────────────────────────────────────────────────
-- 010 — payments idempotency (run in Supabase SQL editor)
--
-- Defence-in-depth for the SUMIT return handler (src/controllers/payment.controller.ts).
--
-- /api/payments/return is a PUBLIC endpoint that reads the SUMIT PaymentID out
-- of the query string. Application code now refuses to settle a payment row
-- with a SUMIT PaymentID that another row has already consumed
-- (`sumitPaymentIdAlreadyConsumed`), which stops a paid PaymentID from being
-- replayed against a second, unpaid payment row. This index enforces the same
-- invariant in the database, so the rule holds even against a race between two
-- concurrent returns that both pass the application check.
--
-- Partial on the settled statuses only: many rows legitimately carry a NULL
-- sumit_payment_id (pending/failed), and a row that failed verification may
-- record the id it was offered without ever being granted.
--
-- If this fails with a uniqueness violation, DO NOT force it — it means two
-- settled payments already share one SUMIT PaymentID, which is exactly the
-- double-grant this is meant to prevent. Investigate those rows first:
--   select sumit_payment_id, count(*), array_agg(id)
--   from public.payments
--   where sumit_payment_id is not null and status in ('paid','processing')
--   group by 1 having count(*) > 1;
-- ─────────────────────────────────────────────────────────────────────────────

create unique index if not exists payments_sumit_payment_id_settled_uniq
  on public.payments (sumit_payment_id)
  where sumit_payment_id is not null and status in ('paid', 'processing');

-- 'processing' is a new, non-terminal status written by paymentReturn while it
-- claims a row before granting value. Documented here so the status vocabulary
-- stays discoverable next to 008_payments_table.sql:
--   pending | processing | paid | failed | needs_review
comment on column public.payments.status is
  'pending | processing (grant in flight) | paid | failed | needs_review';
