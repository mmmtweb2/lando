// ONE billing/entitlement state for the Google-promotion product (README part 151).
//
// Before this, the plan page, the settings card and the publish dialog each guessed the account's state
// from different fields, and they contradicted each other for an account Moshe set up by hand ("no need
// for a subscription" / "no monthly charge, join now" / "included in your subscription"). Now the server
// derives one state from the two sources of truth, and every screen renders it through the same wording
// helper (client/src/lib/billingState.ts).
//
//   none            no access (never had it, or it ended)
//   grant           access given by hand (beta, pilot, gift), not paid through SUMIT; may have an end date
//   monthly         paying monthly, renews
//   annual          paid for a year, does not renew by itself
//   canceled_until  canceled (or annual set not to continue), access lasts until a date
//   past_due        the last monthly charge failed; grace period, card needs re-entering
//
// Pure: no database here. The controller reads the rows and passes them in.

import { isEntitled } from './entitlements.service';

export const BILLING_STATES = ['none', 'grant', 'monthly', 'annual', 'canceled_until', 'past_due'] as const;
export type BillingStateKind = (typeof BILLING_STATES)[number];

export interface BillingState {
  state: BillingStateKind;
  /** grant: when the access ends (null = no end date set); paying states: the end of the paid period. */
  until: string | null;
  /** monthly/annual/canceled_until/past_due: the cycle of the subscription. */
  cycle: 'month' | 'year' | null;
  /** past_due on the renewal day itself: SUMIT is still charging, nothing to do yet. */
  renewalPending?: boolean;
  /** none: the account had access before, until this date (a subscription or a grant that ended). */
  endedAt?: string | null;
}

export interface ProductRowLike { status: string; current_period_end: string | null; source: string }
export interface SubRowLike {
  status: 'pending' | 'active' | 'past_due' | 'canceled';
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cycle: 'month' | 'year' | string;
}

/**
 * The account's state. A subscription the customer pays for wins over a manual grant (it is what they are
 * billed for, and what they can cancel); a grant wins over nothing. A 'pending' row (a checkout that was
 * opened but never paid) is not a subscription.
 */
export function billingStateOf(
  product: ProductRowLike | null,
  sub: SubRowLike | null,
  opts: { now?: Date; renewalPending?: boolean } = {},
): BillingState {
  const now = opts.now ?? new Date();
  const cycle = sub ? (sub.cycle === 'year' ? 'year' : 'month') : null;
  if (sub && sub.status !== 'pending' && sub.status !== 'canceled'
      && isEntitled({ status: sub.status, current_period_end: sub.current_period_end }, now)) {
    const until = sub.current_period_end;
    if (sub.status === 'past_due') return { state: 'past_due', until, cycle, renewalPending: !!opts.renewalPending };
    if (sub.cancel_at_period_end) return { state: 'canceled_until', until, cycle };
    return { state: cycle === 'year' ? 'annual' : 'monthly', until, cycle };
  }
  if (product && product.source !== 'sumit' && isEntitled(product, now)) {
    return { state: 'grant', until: product.current_period_end, cycle: null };
  }
  const endedAt = sub && sub.status !== 'pending' ? sub.current_period_end
    : product ? product.current_period_end : null;
  return { state: 'none', until: null, cycle: null, endedAt: endedAt ?? null };
}
