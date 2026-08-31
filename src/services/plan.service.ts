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
  const row = await loadPlanRow(email);
  if (row.is_admin) return;
  const { def, active } = resolvePlan(row);
  if (!active || def.monthlyCreate <= 0) return; // cap only applies to active paid plans

  const period = currentPeriodKey();
  const used = row.period_key === period ? row.pages_created_period ?? 0 : 0;
  if (used >= def.monthlyCreate) {
    throw new Error('monthly_create_limit');
  }
  await supabase
    .from('user_profiles')
    .update({ pages_created_period: used + 1, period_key: period })
    .eq('email', row.email);
}

/**
 * Activate/renew a paid plan after a confirmed payment: set expiry one year out,
 * refill the plan's monthly AI credits, and reset the monthly-create counter.
 * Returns false for an unknown/free plan key.
 */
export async function activatePlan(email: string, planKey: string): Promise<boolean> {
  const def = PLANS[planKey as PlanKey];
  if (!def || def.key === 'free') return false;
  const row = await loadPlanRow(email);

  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);

  const { error } = await supabase
    .from('user_profiles')
    .update({
      plan: def.key,
      plan_expires_at: expires.toISOString(),
      credits: (row.credits ?? 0) + def.monthlyCredits,
      pages_created_period: 0,
      period_key: currentPeriodKey(),
    })
    .eq('email', row.email);

  if (error) {
    console.error('[PLAN] activate failed:', error.message);
    return false;
  }
  return true;
}
