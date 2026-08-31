import { supabase } from '../config/supabase';
import { ensureUserProfile } from './profile.service';
import { PLANS, PlanDef, PlanKey } from '../config/plans';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlanStatus {
  plan: PlanKey;
  label: string;
  active: boolean; // paid plan that hasn't lapsed
  expiresAt: string | null;
  maxActivePages: number;
  activePages: number; // currently-published pages
  monthlyCreate: number; // 0 = unlimited/not enforced
  createdThisPeriod: number;
  whiteLabel: boolean;
}

interface PlanRow {
  email: string;
  plan: string | null;
  plan_expires_at: string | null;
  pages_created_period: number | null;
  period_key: string | null;
  credits: number | null;
  is_admin: boolean | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** 'YYYY-MM' bucket the monthly-create counter belongs to. */
function currentPeriodKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function loadPlanRow(email: string): Promise<PlanRow> {
  const normalized = email.trim().toLowerCase();
  await ensureUserProfile(normalized); // self-heal a missing profile
  const { data } = await supabase
    .from('user_profiles')
    .select('email, plan, plan_expires_at, pages_created_period, period_key, credits, is_admin')
    .eq('email', normalized)
    .single();
  return (data as PlanRow) ?? {
    email: normalized, plan: 'free', plan_expires_at: null,
    pages_created_period: 0, period_key: null, credits: 0, is_admin: false,
  };
}

/** Resolve the row's plan definition and whether it's an active (non-lapsed) paid plan. */
function resolvePlan(row: PlanRow): { def: PlanDef; active: boolean } {
  const def = PLANS[(row.plan as PlanKey) ?? 'free'] ?? PLANS.free;
  const active =
    def.key !== 'free' &&
    !!row.plan_expires_at &&
    new Date(row.plan_expires_at).getTime() > Date.now();
  return { def, active };
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

/** Full plan + usage snapshot for the dashboard. */
export async function getPlanStatus(email: string): Promise<PlanStatus> {
  const row = await loadPlanRow(email);
  const { def, active } = resolvePlan(row);
  const activePages = await countActivePages(email);
  const samePeriod = row.period_key === currentPeriodKey();
  return {
    plan: def.key,
    label: def.label,
    active,
    expiresAt: active ? row.plan_expires_at : null,
    maxActivePages: def.maxActivePages,
    activePages,
    monthlyCreate: def.monthlyCreate,
    createdThisPeriod: samePeriod ? row.pages_created_period ?? 0 : 0,
    whiteLabel: active && def.whiteLabel,
  };
}

/**
 * Can this user publish a page under their active plan (no per-page charge)?
 * Returns { covered:true } when an active plan still has a free live-page slot.
 * Returns { covered:false, reason } when there is no plan or the slot is full —
 * the caller then falls back to the per-page (249₪) payment flow.
 */
export async function canPublishUnderPlan(
  email: string,
): Promise<{ covered: boolean; reason?: string; def: PlanDef }> {
  const row = await loadPlanRow(email);
  const { def, active } = resolvePlan(row);
  if (!active) return { covered: false, reason: 'no_active_plan', def };
  const activePages = await countActivePages(email);
  if (activePages >= def.maxActivePages) {
    return { covered: false, reason: 'active_limit_reached', def };
  }
  return { covered: true, def };
}

/**
 * Enforce + record the monthly page-creation cap for PLAN HOLDERS.
 * Free users (monthlyCreate === 0) and admins are never capped.
 * Throws Error('monthly_create_limit') when the cap is hit.
 */
export async function consumeMonthlyCreate(email: string): Promise<void> {
  let row = await loadPlanRow(email);
  if (row.is_admin) return;
  const { def, active } = resolvePlan(row);
  if (!active || def.monthlyCreate <= 0) return; // cap only applies to active paid plans

  const period = currentPeriodKey();

  // Compare-and-swap on (period_key, pages_created_period), the same shape as
  // credits.service.ts's atomic `.gte()` guard. The previous version read the
  // counter and then wrote `used + 1` unconditionally, so N page creations
  // fired at once all read the same value and all wrote the same increment —
  // the cap could be overrun, and creations could go uncounted entirely.
  //
  // Each attempt re-reads, re-checks the cap, and only writes if the counter is
  // still exactly what it read. Losing the swap means someone else incremented
  // concurrently, so we retry against the fresh value.
  for (let attempt = 0; attempt < 3; attempt++) {
    const samePeriod = row.period_key === period;
    const used = samePeriod ? row.pages_created_period ?? 0 : 0;
    if (used >= def.monthlyCreate) {
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

    row = await loadPlanRow(email); // lost the race; re-read and try again
  }

  // Three consecutive lost swaps means heavy concurrent creation by one
  // account. Allow this one through rather than falsely blocking a paying
  // customer: the worst case is a small overrun of the monthly cap, whereas a
  // spurious 429 blocks work they have paid for. Logged so it is visible if it
  // ever happens for real.
  console.warn('[PLAN] consumeMonthlyCreate: gave up after 3 contended attempts', { email: row.email, period });
}

/**
 * Activate/renew a paid plan after a confirmed payment: extend the expiry by one
 * year, refill the plan's monthly AI credits, and reset the monthly-create
 * counter. Returns false for an unknown/free plan key.
 *
 * ── Expiry policy (money-adjacent — read before changing) ────────────────────
 * A plan term is one year, and every purchase (first buy, renewal, or mid-cycle
 * upgrade) buys exactly one more year. So the new expiry is:
 *
 *     one year from the CURRENT expiry, if that expiry is still in the future
 *     one year from NOW, otherwise (first purchase, or a lapsed plan)
 *
 * This used to be an unconditional `new Date()` + 1 year, which silently threw
 * away whatever time was left on an unexpired plan: a user who upgraded
 * freelancer→agency in month 3 forfeited the 9 months they had already paid
 * for. Carrying the remaining time forward is the customer-favourable reading
 * and is chosen deliberately over a pro-rata cash/day credit:
 *   • it is exact — no rounding, no fractional days, nothing to audit later;
 *   • it can only ever give the customer MORE time than the old code did, never
 *     less, so it cannot under-deliver on something already paid for;
 *   • the alternative (converting the old plan's unused days into a discounted
 *     number of days at the new plan's price) is a pricing decision, not a
 *     technical one, and would need Moshe's sign-off.
 * The known trade-off: after an upgrade, time bought at the cheaper tier is
 * honoured at the more expensive tier. That is a small, bounded giveaway
 * (at most one term of the lower plan) and is intentional.
 */
export async function activatePlan(email: string, planKey: string): Promise<boolean> {
  const def = PLANS[planKey as PlanKey];
  if (!def || def.key === 'free') return false;

  // All-or-nothing, deliberately: every field is written by ONE update.
  // grantPaymentValue treats `false` as "nothing was granted" and leaves the
  // payment at 'needs_review' for an admin to retry, so a partial write here
  // would be dangerous — with the carry-forward expiry above, a retry after a
  // partial success would add a SECOND year. Keeping it to one statement means
  // a failure changes nothing and a retry is always correct.
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await loadPlanRow(email);

    // Start from the existing expiry when it is still in the future, otherwise now.
    const now = new Date();
    const currentExpiry = row.plan_expires_at ? new Date(row.plan_expires_at) : null;
    const base =
      currentExpiry && !Number.isNaN(currentExpiry.getTime()) && currentExpiry.getTime() > now.getTime()
        ? currentExpiry
        : now;
    const expires = new Date(base.getTime());
    expires.setFullYear(expires.getFullYear() + 1);

    const currentCredits = row.credits ?? 0;
    const { data, error } = await supabase
      .from('user_profiles')
      .update({
        plan: def.key,
        plan_expires_at: expires.toISOString(),
        credits: currentCredits + def.monthlyCredits,
        pages_created_period: 0,
        period_key: currentPeriodKey(),
      })
      .eq('email', row.email)
      // Compare-and-swap on the balance this write is derived from: without it,
      // credits the user spent between the read above and this write would be
      // silently restored (a mint), the same stale read-then-write bug fixed in
      // landing.controller.ts's image-batch charge.
      .eq('credits', currentCredits)
      .select('email')
      .maybeSingle();

    if (error) {
      console.error('[PLAN] activate failed:', error.message);
      return false;
    }
    if (data) return true;
    // Lost the swap (balance moved mid-activation) — re-read and try again.
  }

  console.error('[PLAN] activate failed: balance kept changing under the activation write', { email });
  return false;
}
