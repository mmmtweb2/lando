// Monthly subscription for the Google-promotion product (Stage 9.2). Owns the DB side:
// seo_subscriptions (our state), seo_subscription_events (replay guard), and the mirror into
// user_products (the entitlement everything else reads). The state rules are in
// subscriptionState.ts; the SUMIT field names are in sumitRecurring.ts.

import { withHeartbeat } from './opsMetrics.service';
import { logEvent } from './journey.service';
import { supabase } from '../config/supabase';
import { seoPlanName, seoSubscriptionEnabled, seoTestPrice } from '../config/seoPlan';
import { SEO_ANNUAL_REMINDER_DAYS, SeoCycle, SeoPlan, SeoPlanId, getSeoPlan, planFor, isSellable } from '../config/seoCatalog';
import { isEntitled } from './entitlements.service';
import { summitConfigured } from './summit.service';
import { AddonAccess, reconcileAddonPage } from './seoPageAddon.service';
import { AnnualReminderParams, sendAnnualReminder } from './seoReminder.mailer';
import { beginRecurringRedirect, beginSinglePaymentRedirect, cancelRecurring, createStandingOrder, standingOrderAfterPayment } from './sumitRecurring';
import {
  SubState, SubStatus, applyCancel, applyChargeFailed, applyChargeOk, expire, sameState, toEntitlementRow,
} from './subscriptionState';

const API_URL = (process.env.PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export type SubErrorCode = 'bad_plan' | 'not_migrated' | 'db' | 'disabled' | 'already_has_access' | 'already_subscribed' | 'no_subscription' | 'sumit';
export class SubError extends Error {
  constructor(public code: SubErrorCode, message?: string) { super(message ?? code); }
}

export interface SubRow {
  id: string;
  email: string;
  status: SubStatus;
  amount: number;
  sumit_customer_id: string | null;
  sumit_recurring_item_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  needs_manual_cancel: boolean;
  plan_id: SeoPlanId;
  cycle: SeoCycle;
  with_page: boolean;
  reminder_for_period_end: string | null;
}

const COLS = 'id, email, status, amount, sumit_customer_id, sumit_recurring_item_id, current_period_end, cancel_at_period_end, needs_manual_cancel, plan_id, cycle, with_page, reminder_for_period_end';

/** An annual subscription is one payment for the year: nothing renews, so nothing can be "past due". */
export function autoRenews(r: Pick<SubRow, 'cycle'>): boolean {
  return r.cycle !== 'year';
}

/**
 * Is this subscription's included landing page active right now? Every plan includes one page
 * (12.11.2026), so this is simply "does the subscription give access" (grace included), whatever
 * the stored with_page says: customers who bought before the change get the page too.
 */
export function addonAccessOf(r: Pick<SubRow, 'status' | 'current_period_end'> & { with_page?: boolean }, now = new Date()): AddonAccess {
  return {
    active: isEntitled({ status: r.status, current_period_end: r.current_period_end }, now),
    periodEnd: r.current_period_end,
  };
}

/**
 * Does this ACCOUNT have the product right now, and until when? Read from user_products, which is
 * where access is decided for everyone: a SUMIT subscription is mirrored into it, and an account
 * Moshe set up by hand (billed outside the system, a beta, a pilot) has only this row. So the
 * included page follows the same rule as the product itself, however the customer pays.
 */
export async function pageAccessFor(email: string, now = new Date()): Promise<AddonAccess> {
  const { data, error } = await supabase.from('user_products').select('status, current_period_end')
    .eq('email', email.trim().toLowerCase()).eq('product', 'seo_autopilot').maybeSingle();
  if (error) throw dbError(error);
  const r = data as { status: string; current_period_end: string | null } | null;
  return { active: !!r && isEntitled(r, now), periodEnd: r?.current_period_end ?? null };
}

/** Bring the included page in line with the account's access. Never throws: a page hiccup must not fail a payment or the sweep. */
async function syncAddonPage(email: string): Promise<void> {
  try {
    const done = await reconcileAddonPage(email, await pageAccessFor(email));
    if (done === 'frozen' || done === 'unfrozen') console.log('[SUBSCRIPTION] included page', done);
  } catch (e) {
    console.error('[SUBSCRIPTION] included page sync failed:', e instanceof Error ? e.message : e);
  }
}

/** The plan a stored row is on (rows from before migration 046 are monthly without a page). */
export function planOf(r: Pick<SubRow, 'plan_id' | 'cycle' | 'with_page'>): SeoPlan {
  return getSeoPlan(r.plan_id) ?? planFor(r.cycle === 'year' ? 'year' : 'month', !!r.with_page);
}

function dbError(e: { code?: string; message: string }): SubError {
  // 42P01 = undefined_table: the code was deployed before migration 030 was run.
  if (e.code === '42P01' || /seo_subscriptions/.test(e.message) && /does not exist|schema cache/.test(e.message)) {
    return new SubError('not_migrated');
  }
  console.error('[SUBSCRIPTION] db error:', e.message);
  return new SubError('db', e.message);
}

export function stateOf(r: SubRow): SubState {
  return {
    status: r.status,
    currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end) : null,
    cancelAtPeriodEnd: r.cancel_at_period_end,
  };
}

export async function getSubscription(email: string): Promise<SubRow | null> {
  const { data, error } = await supabase
    .from('seo_subscriptions').select(COLS).eq('email', email.trim().toLowerCase()).maybeSingle();
  if (error) throw dbError(error);
  return (data as SubRow | null) ?? null;
}

async function getById(id: string): Promise<SubRow | null> {
  const { data, error } = await supabase.from('seo_subscriptions').select(COLS).eq('id', id).maybeSingle();
  if (error) throw dbError(error);
  return (data as SubRow | null) ?? null;
}

/** Writes the subscription state and mirrors it into user_products (never over a manual grant). */
async function saveState(row: SubRow, next: SubState, extra: Record<string, unknown> = {}): Promise<void> {
  const { error } = await supabase.from('seo_subscriptions').update({
    status: next.status,
    current_period_end: next.currentPeriodEnd ? next.currentPeriodEnd.toISOString() : null,
    cancel_at_period_end: next.cancelAtPeriodEnd,
    updated_at: new Date().toISOString(),
    ...extra,
  }).eq('id', row.id);
  if (error) throw dbError(error);
  await mirrorEntitlement(row.email, next);
}

async function mirrorEntitlement(email: string, s: SubState): Promise<void> {
  const mirror = toEntitlementRow(s);
  if (!mirror) return;
  const { data: existing, error: readErr } = await supabase
    .from('user_products').select('source, status').eq('email', email).eq('product', 'seo_autopilot').maybeSingle();
  if (readErr) { console.error('[SUBSCRIPTION] entitlement read failed:', readErr.message); return; }
  const ex = existing as { source: string; status: string } | null;
  // A manual grant (pilot customer, gift) is never overwritten by a payment event.
  if (ex && ex.source !== 'sumit' && ex.status === 'active') return;
  const { error } = await supabase.from('user_products').upsert(
    { email, product: 'seo_autopilot', status: mirror.status, current_period_end: mirror.current_period_end, source: 'sumit' },
    { onConflict: 'email,product' },
  );
  if (error) console.error('[SUBSCRIPTION] entitlement mirror failed:', error.message);
}

// ─── Start ──────────────────────────────────────────────────────────────────

export async function startSubscription(email: string, planId: unknown = 'monthly'): Promise<{ redirectUrl: string }> {
  if (!seoSubscriptionEnabled() || !summitConfigured()) throw new SubError('disabled');
  const plan = isSellable(planId) ? getSeoPlan(planId) : null;
  if (!plan) throw new SubError('bad_plan');
  // Payment test mode (SEO_TEST_PRICE + SEO_TEST_EMAILS): listed accounts pay the test amount on any plan.
  const testPrice = seoTestPrice(email);
  const price = testPrice ?? plan.price;
  if (testPrice !== null) console.warn('[SUBSCRIPTION] payment test mode: charging the test price for a listed account');

  // Already has the product some other way (e.g. a manual grant)? Do not bill them for it.
  // Exception: an account in payment test mode (the owner's admin account) may pay the test price so the
  // whole path can be exercised without resetting its grants. mirrorEntitlement never overwrites a manual grant.
  const { data: prod } = await supabase
    .from('user_products').select('status, current_period_end, source').eq('email', email).eq('product', 'seo_autopilot').maybeSingle();
  const p = prod as { status: string; current_period_end: string | null; source: string } | null;
  if (p && p.source !== 'sumit' && isEntitled(p) && testPrice === null) throw new SubError('already_has_access');

  const existing = await getSubscription(email);
  if (existing && existing.status === 'active' && !existing.cancel_at_period_end
      && isEntitled({ status: existing.status, current_period_end: existing.current_period_end })) {
    throw new SubError('already_subscribed');
  }
  // A customer whose last charge failed re-enters their card through a NEW standing order.
  // Stop the old one first, or both could charge them once the card works again.
  if (existing?.status === 'past_due' && existing.sumit_recurring_item_id) {
    const stopped = await cancelRecurring(existing.sumit_customer_id, existing.sumit_recurring_item_id);
    if (!stopped) throw new SubError('sumit', 'לא הצלחנו לעדכן את המנוי הקודם. נסו שוב או פנו אלינו.');
    await supabase.from('seo_subscriptions').update({ sumit_recurring_item_id: null }).eq('id', existing.id);
  }

  let subId: string;
  if (!existing) {
    const { data, error } = await supabase.from('seo_subscriptions')
      .insert({ email, status: 'pending', amount: price, plan_id: plan.id, cycle: plan.cycle, with_page: plan.withPage }).select('id').single();
    if (error || !data) throw dbError(error ?? { message: 'insert failed' });
    subId = (data as { id: string }).id;
  } else {
    subId = existing.id;
    const patch: Record<string, unknown> = {
      amount: price, plan_id: plan.id, cycle: plan.cycle, with_page: plan.withPage, updated_at: new Date().toISOString(),
    };
    if (existing.status === 'canceled' || existing.status === 'pending') patch.status = 'pending';
    const { error } = await supabase.from('seo_subscriptions').update(patch).eq('id', subId);
    if (error) throw dbError(error);
  }

  const common = {
    itemName: seoPlanName(),
    amount: price,
    externalIdentifier: subId,
    redirectUrl: `${API_URL}/api/seo/subscription/return?ref=${subId}`,
    cancelRedirectUrl: `${API_URL}/api/seo/subscription/return?ref=${subId}&cancel=1`,
    customerEmail: email,
  };
  try {
    // Monthly = a standing order. Annual = ONE payment (installments are the customer's choice on
    // SUMIT's page), never auto-renewed.
    return plan.cycle === 'year'
      ? await beginSinglePaymentRedirect({ ...common, maxInstallments: 12 })
      : await beginRecurringRedirect(common);
  } catch (e) {
    throw new SubError('sumit', e instanceof Error ? e.message : undefined);
  }
}

// ─── A SUMIT payment was reported (return redirect, trigger, or sweep) ──────

export type PaymentOutcome = 'activated' | 'failed' | 'duplicate' | 'conflict' | 'underpaid' | 'ignored' | 'unknown';

export async function applyVerifiedPayment(
  subscriptionId: string,
  payment: { sumitPaymentId: string; valid: boolean; amount: number },
  extra: { sumitCustomerId?: string; sumitRecurringItemId?: string } = {},
  now = new Date(),
): Promise<PaymentOutcome> {
  const row = await getById(subscriptionId);
  if (!row) return 'unknown';

  const sufficient = payment.valid && payment.amount + 0.01 >= Number(row.amount);
  const kind = sufficient ? 'charge_ok' : 'charge_failed';

  // One SUMIT payment id is consumed by ONE thing across the whole system (migration 044): if a
  // one-time payment row already settled with it, it cannot also activate a subscription.
  const { data: usedByPayment, error: payErr } = await supabase
    .from('payments').select('id').eq('sumit_payment_id', payment.sumitPaymentId).in('status', ['paid', 'processing']).limit(1);
  if (payErr && payErr.code !== '42P01') throw dbError(payErr);   // 42P01: no payments table at all -> nothing to collide with
  if ((usedByPayment ?? []).length > 0) return 'conflict';

  // Replay guard FIRST: one SUMIT payment id can move a subscription once, ever.
  const { error: evErr } = await supabase.from('seo_subscription_events').insert({
    subscription_id: row.id, kind, sumit_payment_id: payment.sumitPaymentId, amount: payment.amount,
  });
  if (evErr) {
    if (evErr.code === '23505') {
      // Same subscription replaying its own payment = harmless duplicate; any other owner of the id
      // (another subscription, or a one-time payment caught by the database claim) = conflict.
      const { data: own } = await supabase.from('seo_subscription_events').select('id')
        .eq('sumit_payment_id', payment.sumitPaymentId).eq('subscription_id', row.id).limit(1);
      return (own ?? []).length > 0 ? 'duplicate' : 'conflict';
    }
    throw dbError(evErr);
  }

  const current = stateOf(row);
  if (sufficient) {
    const { state, ignored } = applyChargeOk(current, now, planOf(row).months);
    if (ignored) {
      console.error('[SUBSCRIPTION] payment on a canceled subscription — needs a human (refund?)', { id: row.id, payment: payment.sumitPaymentId });
      return 'ignored';
    }
    await saveState(row, state, {
      needs_manual_cancel: false,
      ...(extra.sumitCustomerId ? { sumit_customer_id: extra.sumitCustomerId } : {}),
      ...(extra.sumitRecurringItemId ? { sumit_recurring_item_id: extra.sumitRecurringItemId } : {}),
    });
    // A monthly plan is only a subscription if SUMIT holds a standing order. Without its id nothing will charge
    // next month and we cannot cancel it automatically: say so loudly (task #39), the customer still got the month they paid for.
    const customerId = extra.sumitCustomerId ?? row.sumit_customer_id;
    let standingOrderId: string | null = extra.sumitRecurringItemId ?? row.sumit_recurring_item_id;
    // The standing order, created by SUMIT's recurring API on the card the customer just used
    // (sumitRecurring.ts). Once per subscription: this code runs only for the FIRST time a payment
    // id is seen (replay guard above), and only while no standing order is on record. It starts
    // charging at the end of the period that was just paid. Off unless SUMIT_STANDING_ORDER=after_payment.
    if (planOf(row).cycle === 'month' && !standingOrderId && customerId && state.currentPeriodEnd && standingOrderAfterPayment()) {
      const so = await createStandingOrder({ customerId, itemName: 'קידום העסק בגוגל – מנוי חודשי', amount: Number(row.amount), firstCharge: state.currentPeriodEnd }, now);
      if (so.recurringItemId) {
        standingOrderId = so.recurringItemId;
        const { error: soErr } = await supabase.from('seo_subscriptions').update({ sumit_recurring_item_id: so.recurringItemId }).eq('id', row.id);
        if (soErr) console.error('[SUBSCRIPTION] ALERT standing order created in SUMIT but not saved here — cancel will need a human', { id: row.id, recurringItemId: so.recurringItemId });
      }
    }
    if (planOf(row).cycle === 'month' && !standingOrderId) {
      console.error('[SUBSCRIPTION] ALERT monthly payment verified but SUMIT returned NO standing order id — check the SUMIT dashboard; this account will not renew by itself', { id: row.id, payment: payment.sumitPaymentId });
    }
    await syncAddonPage(row.email);   // a frozen included page comes back; a live one gets the new period end
    void logEvent({ event: 'payment_succeeded', email: row.email }); // first verified payment only (unique milestone)
    return 'activated';
  }

  if (payment.valid) {
    console.error('[SUBSCRIPTION] payment valid but below the plan price — not activating', { id: row.id, paid: payment.amount, due: row.amount });
  }
  const failed = applyChargeFailed(current);
  if (!sameState(failed, current)) await saveState(row, failed);
  return payment.valid ? 'underpaid' : 'failed';
}

export async function subscriptionIdExists(id: string): Promise<boolean> {
  return (await getById(id)) !== null;
}

// ─── Cancel ─────────────────────────────────────────────────────────────────

export async function cancelSubscription(email: string, now = new Date()): Promise<SubRow> {
  const row = await getSubscription(email);
  if (!row || row.status === 'canceled') throw new SubError('no_subscription');

  // Stop the charges at SUMIT first. If that fails, the customer's cancellation is still
  // honoured here (access ends at period end) and a human is told to stop it at SUMIT.
  // An annual plan has no standing order, so there is nothing to stop at SUMIT: cancelling only
  // switches off renewal. The paid year stays (no refund for the remaining months, spec §1).
  const stopped = (row.status === 'pending' && !row.sumit_recurring_item_id) || !autoRenews(row)
    ? true
    : await cancelRecurring(row.sumit_customer_id, row.sumit_recurring_item_id);
  if (!stopped) {
    console.error('[SUBSCRIPTION] MANUAL ACTION: cancel the standing order in the SUMIT dashboard for', row.email);
  }

  const next = applyCancel(stateOf(row), now);
  await saveState(row, next, { needs_manual_cancel: !stopped });
  await supabase.from('seo_subscription_events').insert({ subscription_id: row.id, kind: 'canceled' });
  return (await getById(row.id)) as SubRow;
}

// ─── Time-driven housekeeping ────────────────────────────────────────────────

export async function sweepSubscriptions(
  now = new Date(),
  sendReminder: (p: AnnualReminderParams) => Promise<boolean> = sendAnnualReminder,
): Promise<number> {
  const { data, error } = await supabase.from('seo_subscriptions').select(COLS).in('status', ['active', 'past_due']);
  if (error) {
    const e = dbError(error);
    if (e.code !== 'not_migrated') console.error('[SUBSCRIPTION] sweep read failed:', error.message);
    return 0;
  }
  let changed = 0;
  for (const row of (data ?? []) as SubRow[]) {
    const cur = stateOf(row);
    const next = expire(cur, now, autoRenews(row));
    if (sameState(cur, next)) {
      await maybeRemindAnnual(row, now, sendReminder);
      continue;
    }
    try {
      await saveState(row, next);
      changed += 1;
      await syncAddonPage(row.email);
    } catch (e) {
      console.error('[SUBSCRIPTION] sweep update failed:', row.id, e instanceof Error ? e.message : e);
    }
  }
  // Self-healing: every account that holds an included page has it re-aligned with its subscription
  // (canceled and plan-without-page accounts too). A missing table (migration 047 not run) is just empty.
  const { data: claims, error: clErr } = await supabase.from('seo_addon_pages').select('email').limit(5000);
  if (!clErr) for (const r of (claims ?? []) as Array<{ email: string }>) await syncAddonPage(r.email);
  return changed;
}

/**
 * An annual plan does not renew by itself, so the customer is told SEO_ANNUAL_REMINDER_DAYS before
 * the paid year ends. Once per period: `reminder_for_period_end` remembers which end it was sent for
 * and is written only after the mail was accepted, so a failed send is retried by the next sweep.
 */
async function maybeRemindAnnual(row: SubRow, now: Date, send: (p: AnnualReminderParams) => Promise<boolean>): Promise<void> {
  if (autoRenews(row) || row.status !== 'active' || !row.current_period_end) return;
  const end = new Date(row.current_period_end).getTime();
  const daysLeft = (end - now.getTime()) / (24 * 60 * 60 * 1000);
  if (daysLeft <= 0 || daysLeft > SEO_ANNUAL_REMINDER_DAYS) return;
  if (row.reminder_for_period_end && new Date(row.reminder_for_period_end).getTime() === end) return;
  const ok = await send({ to: row.email, periodEnd: row.current_period_end, withPage: true });
  if (!ok) return;
  const { error } = await supabase.from('seo_subscriptions')
    .update({ reminder_for_period_end: row.current_period_end }).eq('id', row.id);
  if (error) console.error('[SUBSCRIPTION] reminder mark failed:', error.message);
}

const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
export function startSubscriptionSweep(): void {
  const run = () => { withHeartbeat('subscriptions', sweepSubscriptions).catch(e => console.error('[SUBSCRIPTION] sweep crashed:', e)); };
  setTimeout(run, 60 * 1000);
  setInterval(run, SWEEP_EVERY_MS).unref?.();
}
