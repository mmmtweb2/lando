// ─────────────────────────────────────────────────────────────────────────────
// Billing service — page-publish balance, monthly creation cap, white-label.
//
// Renamed from plan.service.ts on 2026-09-01, when yearly subscription plans
// were replaced by one-time page bundles (see src/config/billing.ts for the
// model). The rename is deliberate: "plan" was the exact concept being removed,
// and leaving the old name on the file would have every future reader looking
// for a subscription that no longer exists. The HTTP route it feeds
// (GET /api/users/plan) is intentionally NOT renamed — changing a live,
// client-facing URL in the same deploy as a pricing change is gratuitous risk.
//
// The state this file owns, all on `user_profiles`:
//   page_credits        — page-publish balance. +N on purchase, −1 per publish.
//                         Never expires. This replaced the old
//                         "active plan + slot under maxActivePages" check.
//   page_credits_total  — lifetime page credits ever granted. Never decreases.
//                         Used only as the durable "has this account ever paid?"
//                         signal that selects the monthly-creation cap tier.
//   white_label         — permanent perk from the 10-page bundle. Set once on a
//                         successful payment, NEVER revoked (there is no
//                         subscription to lapse any more).
//   pages_created_period / period_key — the monthly page-CREATION counter
//                         (unchanged, shipped 2026-08-31).
//
// CONCURRENCY: PostgREST cannot do `col = col + n`, so every balance write here
// is a read-then-compare-and-swap guarded on the exact value it was derived
// from, retried up to 3 times — the same shape as credits.service.ts's `.gte()`
// guard and the old activatePlan(). Every grant is ALSO all-or-nothing in a
// single UPDATE: a caller that gets `false` can be certain nothing was written,
// which is what makes an admin retry of a failed grant safe (a partial write
// followed by a retry would double-grant).
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '../config/supabase';
import { ensureUserProfile } from './profile.service';
import {
  BUNDLES, BundleKey, FREE_TIER, LEGACY_PLAN_CONVERSION, PAID_TIER, TierDef,
} from '../config/billing';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AccountStatus {
  /** 'free' until the account has ever bought page credits, then 'paid'. */
  tier: TierDef['key'];
  label: string;
  /** Page-publish balance. Publishing a page costs 1. Never expires. */
  pageCredits: number;
  /** Lifetime page credits granted (how many pages they have ever bought). */
  pageCreditsTotal: number;
  /** Currently-published (live) pages. Informational only — not a limit. */
  activePages: number;
  monthlyCreate: number; // 0 = unlimited/not enforced
  createdThisPeriod: number;
  whiteLabel: boolean;
}

interface BillingRow {
  email: string;
  page_credits: number | null;
  page_credits_total: number | null;
  white_label: boolean | null;
  pages_created_period: number | null;
  period_key: string | null;
  credits: number | null;
  is_admin: boolean | null;
}

const SELECT_COLS =
  'email, page_credits, page_credits_total, white_label, pages_created_period, period_key, credits, is_admin';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** 'YYYY-MM' bucket the monthly-create counter belongs to. */
function currentPeriodKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function loadBillingRow(email: string): Promise<BillingRow> {
  const normalized = email.trim().toLowerCase();
  await ensureUserProfile(normalized); // self-heal a missing profile
  const { data } = await supabase
    .from('user_profiles')
    .select(SELECT_COLS)
    .eq('email', normalized)
    .single();
  return (data as BillingRow) ?? {
    email: normalized, page_credits: 0, page_credits_total: 0, white_label: false,
    pages_created_period: 0, period_key: null, credits: 0, is_admin: false,
  };
}

/**
 * Which monthly-creation cap applies. An account that has EVER been granted page
 * credits gets the paid tier's cap — permanently, not while some balance lasts:
 * spending your last page credit must not silently drop you back to 5 drafts a
 * month. `page_credits_total` never decreases, so this is stable.
 */
function tierFor(row: BillingRow): TierDef {
  return (row.page_credits_total ?? 0) > 0 ? PAID_TIER : FREE_TIER;
}

/** Count a user's currently-published (live, non-expired) pages. */
export async function countActivePages(email: string): Promise<number> {
  const normalized = email.trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const { count } = await supabase
    .from('landing_pages')
    .select('id', { count: 'exact', head: true })
    .eq('owner_email', normalized)
    .eq('status', 'published')
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  return count ?? 0;
}

/** Full balance + usage snapshot for the dashboard and the publish flow. */
export async function getAccountStatus(email: string): Promise<AccountStatus> {
  const row = await loadBillingRow(email);
  const tier = tierFor(row);
  const activePages = await countActivePages(email);
  const samePeriod = row.period_key === currentPeriodKey();
  return {
    tier: tier.key,
    label: tier.label,
    pageCredits: row.page_credits ?? 0,
    pageCreditsTotal: row.page_credits_total ?? 0,
    activePages,
    monthlyCreate: tier.monthlyCreate,
    createdThisPeriod: samePeriod ? row.pages_created_period ?? 0 : 0,
    whiteLabel: !!row.white_label,
  };
}

/**
 * Can this user publish a page without paying now?
 *
 * Replaces the old canPublishUnderPlan()'s "active, unexpired plan AND fewer
 * than maxActivePages live pages" test with the whole of the new rule: does the
 * account hold at least one page credit. No expiry, no slot arithmetic, and
 * un-publishing a page no longer refunds anything (the credit was spent when the
 * page went live) — which is both simpler to explain and impossible to game by
 * cycling pages in and out of `published`.
 */
export async function canPublishFromBalance(
  email: string,
): Promise<{ covered: boolean; reason?: string; balance: number }> {
  const row = await loadBillingRow(email);
  const balance = row.page_credits ?? 0;
  if (balance <= 0) return { covered: false, reason: 'no_page_credits', balance: 0 };
  return { covered: true, balance };
}

/**
 * Spend exactly one page credit. Returns false if the balance was empty or the
 * swap kept losing — callers MUST treat false as "not paid for, do not publish".
 * The `.gte('page_credits', 1)` guard means an empty balance can never go
 * negative even if the read above it was stale.
 */
export async function consumePageCredit(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await loadBillingRow(normalized);
    const balance = row.page_credits ?? 0;
    if (balance <= 0) return false;
    const { data } = await supabase
      .from('user_profiles')
      .update({ page_credits: balance - 1 })
      .eq('email', row.email)
      .eq('page_credits', balance) // CAS: only if nobody spent one meanwhile
      .gte('page_credits', 1)
      .select('email')
      .maybeSingle();
    if (data) return true;
  }
  console.error('[BILLING] consumePageCredit: lost the swap 3x', { email: normalized });
  return false;
}

/**
 * Give a spent page credit back. Used ONLY when a publish failed after its
 * credit was already taken, so the customer is never charged for a page that
 * never went live. Not a user-facing refund path — there is no "un-publish and
 * get your credit back" feature.
 */
export async function refundPageCredit(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await loadBillingRow(normalized);
    const balance = row.page_credits ?? 0;
    const { data } = await supabase
      .from('user_profiles')
      .update({ page_credits: balance + 1 })
      .eq('email', row.email)
      .eq('page_credits', balance)
      .select('email')
      .maybeSingle();
    if (data) return true;
  }
  console.error('[BILLING] refundPageCredit FAILED — customer is owed 1 page credit', { email: normalized });
  return false;
}

/**
 * Enforce + record the monthly page-creation cap. Admins are never capped.
 * Free accounts use FREE_TIER's cap (5/month, shipped 2026-08-31 — unchanged);
 * anyone who has ever bought page credits uses PAID_TIER's. monthlyCreate <= 0
 * means "no cap" for whichever tier is in effect.
 * Throws Error('monthly_create_limit') when the cap is hit.
 */
export async function consumeMonthlyCreate(email: string): Promise<void> {
  let row = await loadBillingRow(email);
  if (row.is_admin) return;
  const tier = tierFor(row);
  if (tier.monthlyCreate <= 0) return;

  const period = currentPeriodKey();

  // Compare-and-swap on (period_key, pages_created_period), the same shape as
  // credits.service.ts's atomic `.gte()` guard. The pre-2026-08-31 version read
  // the counter and then wrote `used + 1` unconditionally, so N page creations
  // fired at once all read the same value and all wrote the same increment —
  // the cap could be overrun, and creations could go uncounted entirely.
  //
  // Each attempt re-reads, re-checks the cap, and only writes if the counter is
  // still exactly what it read. Losing the swap means someone else incremented
  // concurrently, so we retry against the fresh value.
  for (let attempt = 0; attempt < 3; attempt++) {
    const samePeriod = row.period_key === period;
    const used = samePeriod ? row.pages_created_period ?? 0 : 0;
    if (used >= tier.monthlyCreate) {
      throw new Error('monthly_create_limit');
    }

    let q = supabase
      .from('user_profiles')
      .update({ pages_created_period: used + 1, period_key: period })
      .eq('email', row.email);
    // Guard on the exact state we based `used` on. For a brand-new period the
    // guard is the OLD period_key (which may be NULL), so the first creation of
    // the month resets the counter exactly once.
    q = samePeriod
      ? q.eq('period_key', period).eq('pages_created_period', used)
      : row.period_key === null
        ? q.is('period_key', null)
        : q.eq('period_key', row.period_key);

    const { data } = await q.select('email').maybeSingle();
    if (data) return; // won the swap — this creation is counted

    row = await loadBillingRow(email); // lost the race; re-read and try again
  }

  // Three consecutive lost swaps means heavy concurrent creation by one
  // account. Allow this one through rather than falsely blocking a paying
  // customer: the worst case is a small overrun of the monthly cap, whereas a
  // spurious block stops work they have paid for. Logged so it is visible if it
  // ever happens for real.
  console.warn('[BILLING] consumeMonthlyCreate: gave up after 3 contended attempts', { email: row.email, period });
}

// ─── Grants (money paths — read the concurrency note at the top of this file) ─

/**
 * The one place that adds page credits. All-or-nothing in a single UPDATE, so
 * `false` provably means "nothing was written" and an admin re-run of a failed
 * grant (force-activate / re-verify) can never double-grant a partial write.
 *
 * @param pages      page credits to add to the balance (and to the lifetime total)
 * @param aiCredits  one-time AI-credit top-up to add alongside (0 for a single page)
 * @param whiteLabel when true, permanently sets the white-label flag. Never unsets it.
 */
async function grantPageCredits(
  email: string,
  pages: number,
  aiCredits: number,
  whiteLabel: boolean,
): Promise<boolean> {
  if (pages <= 0 && aiCredits <= 0 && !whiteLabel) return false;
  const normalized = email.trim().toLowerCase();

  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await loadBillingRow(normalized);
    const curPages = row.page_credits ?? 0;
    const curTotal = row.page_credits_total ?? 0;
    const curCredits = row.credits ?? 0;

    const { data, error } = await supabase
      .from('user_profiles')
      .update({
        page_credits: curPages + pages,
        page_credits_total: curTotal + pages,
        credits: curCredits + aiCredits,
        // Once true, always true — a perk that was paid for is never revoked.
        white_label: whiteLabel || !!row.white_label,
      })
      .eq('email', row.email)
      // CAS on BOTH balances this write is derived from. Without the credits
      // guard, AI credits the user spent between the read and this write would
      // be silently restored (a mint) — the same stale read-then-write bug that
      // was fixed in landing.controller.ts's image-batch charge.
      .eq('page_credits', curPages)
      .eq('credits', curCredits)
      .select('email')
      .maybeSingle();

    if (error) {
      console.error('[BILLING] grantPageCredits failed:', error.message);
      return false;
    }
    if (data) return true;
    // Lost the swap (a balance moved mid-grant) — re-read and try again.
  }

  console.error('[BILLING] grantPageCredits: balances kept changing under the grant write', { email: normalized });
  return false;
}

/**
 * Grant a purchased bundle: N page credits + its one-time AI-credit top-up,
 * plus permanent white-label for the 10-page bundle. Returns false for an
 * unknown key (the caller leaves the payment at 'needs_review').
 */
export async function grantBundle(email: string, bundleKey: string): Promise<boolean> {
  const bundle = BUNDLES[bundleKey as BundleKey];
  if (!bundle) {
    console.error('[BILLING] grantBundle: unknown bundle key', { bundleKey });
    return false;
  }
  return grantPageCredits(email, bundle.pages, bundle.aiCredits, bundle.whiteLabel);
}

/** Grant the single 249₪ page purchase: exactly one page credit, no AI credits. */
export async function grantSinglePageCredit(email: string): Promise<boolean> {
  return grantPageCredits(email, 1, 0, false);
}

/**
 * LEGACY, compatibility only. Honours a `purpose:'plan'` payment row that was
 * already in flight (started under the old subscription checkout) when bundles
 * shipped — that customer's card was charged for freelancer/agency and they must
 * still get value. New `purpose:'plan'` payments can no longer be STARTED
 * (see payment.controller.ts), so this drains and then goes unused.
 *
 * Converts on exactly the same terms as the grandfather migration (012):
 * freelancer → 10 page credits, agency → 40 page credits + white-label. No AI
 * credits: the old plans' `monthlyCredits` were a subscription refill with no
 * equivalent here, and these customers keep whatever balance they already have.
 */
export async function grantLegacyPlan(email: string, planKey: string): Promise<boolean> {
  const conv = LEGACY_PLAN_CONVERSION[planKey];
  if (!conv) {
    console.error('[BILLING] grantLegacyPlan: unknown legacy plan key', { planKey });
    return false;
  }
  console.warn('[BILLING] honouring an in-flight legacy plan payment as page credits', { email, planKey, pages: conv.pages });
  return grantPageCredits(email, conv.pages, 0, conv.whiteLabel);
}
