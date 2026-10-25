// Pure subscription state machine (Stage 9.2). No I/O, so every rule is unit-tested.
//
//   pending ──charge ok──▶ active ──charge failed──▶ past_due ──charge ok──▶ active
//      │                      │                         │
//      └─cancel─▶ canceled    └─cancel─▶ (active until period end) ─expire─▶ canceled
//                                        past_due beyond the grace window ─expire─▶ canceled
//
// Access (isEntitled in entitlements.service.ts) is decided from status + current_period_end;
// this file decides how those two fields move.

import { PAST_DUE_GRACE_DAYS } from './entitlements.service';

export type SubStatus = 'pending' | 'active' | 'past_due' | 'canceled';

export interface SubState {
  status: SubStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

const DAY = 24 * 60 * 60 * 1000;

/** Same day next month; Jan 31 -> Feb 28/29 (never spills into March). */
export function addOneMonth(d: Date): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

/**
 * A verified, sufficient payment arrived. Extends from the later of "now" and the current
 * period end, so an early renewal never loses days and a late one never gives free days.
 * A canceled subscription ignores a late payment (a human decides about the refund).
 */
export function applyChargeOk(s: SubState, now: Date): { state: SubState; ignored: boolean } {
  if (s.status === 'canceled') return { state: s, ignored: true };
  const base = s.currentPeriodEnd && s.currentPeriodEnd.getTime() > now.getTime() ? s.currentPeriodEnd : now;
  return {
    state: { status: 'active', currentPeriodEnd: addOneMonth(base), cancelAtPeriodEnd: false },
    ignored: false,
  };
}

/** A charge failed. A first charge that fails leaves the subscription pending. */
export function applyChargeFailed(s: SubState): SubState {
  if (s.status === 'active') return { ...s, status: 'past_due' };
  return s;
}

/** The customer cancels. Access continues to the end of the paid period. */
export function applyCancel(s: SubState, now: Date): SubState {
  if (s.status === 'canceled') return s;
  const paidThrough = s.currentPeriodEnd && s.currentPeriodEnd.getTime() > now.getTime();
  if (s.status === 'pending' || !paidThrough) {
    return { status: 'canceled', currentPeriodEnd: s.currentPeriodEnd, cancelAtPeriodEnd: false };
  }
  return { ...s, cancelAtPeriodEnd: true };
}

/** Time-driven transitions, run by the sweep. Returns the same object when nothing changes. */
export function expire(s: SubState, now: Date): SubState {
  if (s.status === 'canceled' || s.status === 'pending') return s;
  const end = s.currentPeriodEnd ? s.currentPeriodEnd.getTime() : null;
  if (end === null) return s;
  if (end > now.getTime()) return s;
  if (s.cancelAtPeriodEnd) return { ...s, status: 'canceled', cancelAtPeriodEnd: false };
  if (s.status === 'active') return { ...s, status: 'past_due' };
  if (s.status === 'past_due' && now.getTime() >= end + PAST_DUE_GRACE_DAYS * DAY) {
    return { ...s, status: 'canceled' };
  }
  return s;
}

/** What to mirror into user_products, or null when the account must not hold the product yet. */
export function toEntitlementRow(s: SubState): { status: 'active' | 'past_due' | 'canceled'; current_period_end: string | null } | null {
  if (s.status === 'pending') return null;
  return { status: s.status, current_period_end: s.currentPeriodEnd ? s.currentPeriodEnd.toISOString() : null };
}

export function sameState(a: SubState, b: SubState): boolean {
  return a.status === b.status
    && a.cancelAtPeriodEnd === b.cancelAtPeriodEnd
    && (a.currentPeriodEnd?.getTime() ?? null) === (b.currentPeriodEnd?.getTime() ?? null);
}
