-- ─────────────────────────────────────────────────────────────────────────────
-- 008 — payments table (run in Supabase SQL editor)
--
-- Tracks each real (SUMIT) payment intent across the redirect round-trip, so the
-- return handler knows what the payment was for, can verify it server-to-server,
-- and grants value exactly once (idempotency + audit).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.payments (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  user_email        text not null,
  purpose           text not null,                       -- 'publish' | 'credits'
  reference         text,                                -- landing_page id (publish) or pack key (credits)
  amount            numeric not null,                    -- ₪, VAT-inclusive
  status            text not null default 'pending',     -- pending | paid | failed | needs_review
  sumit_payment_id  text,
  paid_at           timestamptz
);

create index if not exists payments_user_email_idx on public.payments (user_email);

-- Consistent with the RLS lockdown (007): backend uses service_role (bypasses
-- RLS); the browser never touches this table. Enabling RLS with no policies
-- denies anon/authenticated by default.
alter table public.payments enable row level security;
alter table public.payments force row level security;
