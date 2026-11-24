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
import { ChargeEvent, RefundOffer, refundOffer } from './seoRefund';
import {
  CouponReason, CouponRow, checkCoupon, checkCouponRetry, recordRedemption, redeemCoupon, releaseRedemption, seoCouponPricing,
} from './coupon.service';
import { sendRefundMails } from './refundMail';

const API_URL = (process.env.PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export type SubErrorCode = 'coupon' | 'bad_plan' | 'not_migrated' | 'db' | 'disabled' | 'already_has_access' | 'already_subscribed' | 'no_subscription' | 'sumit' | 'sumit_timeout';
export class SubError extends Error {
  /** coupon: the reason code (README part 151) and, for wrong_plan, the plans the code fits. */
  constructor(public code: SubErrorCode, message?: string, public detail?: { reason?: CouponReason; fits?: string[] }) { super(message ?? code); }
}

/**
 * How long we wait for SUMIT to open its payment page before telling the customer to try again (README
 * part 151). Only the beginredirect call is bounded: it creates nothing that can charge anyone (a page
 * the customer never opens expires on its own), so giving up on it is safe. SUMIT_REDIRECT_TIMEOUT_MS
 * overrides it (5–60 s).
 */
export function redirectTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.SUMIT_REDIRECT_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 5000 && n <= 60000 ? n : 20000;
}

/** Resolves like `p`, or rejects with SubError('sumit_timeout') after `ms`. The late answer is ignored. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new SubError('sumit_timeout')), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
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
  // Migration 056 (README part 148). Absent on a database where it has not run.
  coupon_id?: string | null;
  /** What the standing order charges each month. NULL/absent = same as `amount`. */
  recurring_amount?: number | string | null;
  /** ₪ taken off the first payment by the coupon. */
  discount_amount?: number | string | null;
}

// '*' rather than a column list: it reads the coupon columns of migration 056 when they exist and does not
// fail when they do not (a named missing column would make every subscription read fail before 056 runs).
const COLS = '*';

/** The coupon columns hold something: a new checkout without a code must clear them, or a stale discount survives. */
function hasCouponFields(r: SubRow | null): boolean {
  return !!r && (r.coupon_id != null || r.recurring_amount != null || r.discount_amount != null);
}

/** What each later payment (the standing order) must be: the coupon's recurring price, else the subscription amount. */
export function recurringAmountOf(r: Pick<SubRow, 'amount' | 'recurring_amount'>): number {
  return r.recurring_amount != null ? Number(r.recurring_amount) : Number(r.amount);
}

export interface PricingView {
  /** The plan's catalog price for one cycle. */
  list: number;
  /** What the first payment cost with the coupon, or null when no coupon priced it. */
  first: number | null;
  /** What the next automatic charge will be (monthly), or null (annual: nothing renews). */
  next: number | null;
  couponDuration: 'first' | 'forever' | null;
}

/** The prices the customer's card shows. Derived from the row only: no coupon lookup, nothing secret. */
export function pricingView(r: SubRow): PricingView {
  const list = planOf(r).price;
  const discount = r.discount_amount != null ? Number(r.discount_amount) : 0;
  const hasCoupon = !!r.coupon_id && discount > 0;
  const first = hasCoupon ? Math.round((list - discount) * 100) / 100 : null;
  const next = autoRenews(r) ? recurringAmountOf(r) : null;
  const couponDuration = !hasCoupon ? null
    : r.recurring_amount != null && Number(r.recurring_amount) < list ? 'forever' : 'first';
  return { list, first, next, couponDuration };
}

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
    .from('user_products').select('source, status, current_period_end').eq('email', email).eq('product', 'seo_autopilot').maybeSingle();
  if (readErr) { console.error('[SUBSCRIPTION] entitlement read failed:', readErr.message); return; }
  const ex = existing as { source: string; status: string; current_period_end: string | null } | null;
  // A manual grant (pilot customer, gift) is never overwritten by a payment event while it still gives
  // access. An EXPIRED grant (a beta that ended) must give way, or a customer who then pays gets nothing.
  if (ex && ex.source !== 'sumit' && isEntitled(ex)) return;
  const { error } = await supabase.from('user_products').upsert(
    { email, product: 'seo_autopilot', status: mirror.status, current_period_end: mirror.current_period_end, source: 'sumit' },
    { onConflict: 'email,product' },
  );
  if (error) console.error('[SUBSCRIPTION] entitlement mirror failed:', error.message);
}

// ─── Start ──────────────────────────────────────────────────────────────────

/** The coupon purpose of a plan: the monthly and the annual plan are ticked separately in the admin panel. */
export function couponPurposeFor(plan: Pick<SeoPlan, 'cycle'>): 'seo_monthly' | 'seo_annual' {
  return plan.cycle === 'year' ? 'seo_annual' : 'seo_monthly';
}

export async function startSubscription(email: string, planId: unknown = 'monthly', opts: { couponCode?: string } = {}): Promise<{ redirectUrl: string }> {
  if (!seoSubscriptionEnabled() || !summitConfigured()) throw new SubError('disabled');
  const plan = isSellable(planId) ? getSeoPlan(planId) : null;
  if (!plan) throw new SubError('bad_plan');
  // Payment test mode (SEO_TEST_PRICE + SEO_TEST_EMAILS): listed accounts pay the test amount on any plan.
  // The test price WINS over a coupon: a code sent by a test account is ignored and no use is counted.
  const testPrice = seoTestPrice(email);
  let price = testPrice ?? plan.price;
  if (testPrice !== null) console.warn('[SUBSCRIPTION] payment test mode: charging the test price for a listed account');

  // Already has the product some other way (e.g. a manual grant)? Do not bill them for it.
  // Exception: an account in payment test mode (the owner's admin account) may pay the test price so the
  // whole path can be exercised without resetting its grants. mirrorEntitlement never overwrites a manual grant.
  // Timings of each step before the redirect (README part 151: "פותחים תשלום…" took 5–15 s). Logged on
  // every start so production shows where the time goes; no personal data in the line.
  const t0 = Date.now();
  const marks: Record<string, number> = {};
  const mark = (k: string) => { marks[k] = Date.now() - t0; };
  // The two reads are independent: run them together (they used to run one after the other).
  const [{ data: prod }, existing] = await Promise.all([
    supabase.from('user_products').select('status, current_period_end, source').eq('email', email).eq('product', 'seo_autopilot').maybeSingle(),
    getSubscription(email),
  ]);
  mark('reads');
  const p = prod as { status: string; current_period_end: string | null; source: string } | null;
  if (p && p.source !== 'sumit' && isEntitled(p) && testPrice === null) throw new SubError('already_has_access');

  if (existing && existing.status === 'active' && !existing.cancel_at_period_end
      && isEntitled({ status: existing.status, current_period_end: existing.current_period_end })) {
    throw new SubError('already_subscribed');
  }

  // ── Coupon (optional, README part 148). Checked read-only HERE, before anything changes (the old
  // standing order below is stopped only once the code is known to be good). Consumed further down, by the
  // same compare-and-swap as a landing-page checkout, right before the checkout is written.
  const code = (opts.couponCode ?? '').trim();
  const purpose = couponPurposeFor(plan);
  let coupon: CouponRow | null = null;
  let alreadyCounted = false;
  if (code && testPrice !== null) {
    console.warn('[SUBSCRIPTION] payment test mode: the test price wins, the coupon code is ignored');
  } else if (code) {
    // Re-opening the checkout of the same unpaid subscription with the same code: that use was counted
    // when the first checkout opened. Without this a closed SUMIT tab would lock the customer out of
    // their own one-per-customer code.
    if (existing?.status === 'pending' && existing.coupon_id) {
      const retry = await checkCouponRetry(code, purpose, existing.coupon_id);
      if (retry.ok) { coupon = retry.coupon; alreadyCounted = true; }
    }
    if (!coupon) {
      const check = await checkCoupon(code, purpose, email);
      if (!check.ok) throw new SubError('coupon', check.error, { reason: check.reason, fits: check.fits });
      coupon = check.coupon;
    }
    mark('coupon');
  }
  // A customer whose last charge failed re-enters their card through a NEW standing order.
  // Stop the old one first, or both could charge them once the card works again.
  // A canceled row can still carry the id of an order that was never stopped: stop it too, or the stale
  // id would also block the new standing order after this payment.
  if ((existing?.status === 'past_due' || existing?.status === 'canceled') && existing.sumit_recurring_item_id) {
    const stopped = await cancelRecurring(existing.sumit_customer_id, existing.sumit_recurring_item_id);
    if (!stopped) throw new SubError('sumit', 'לא הצלחנו לעדכן את המנוי הקודם. נסו שוב או פנו אלינו.');
    await supabase.from('seo_subscriptions').update({ sumit_recurring_item_id: null }).eq('id', existing.id);
    mark('stop_old_order');
  }

  // Consume one use (unless this checkout already holds one). A lost CAS = exhausted or switched off since
  // the check: no discounted checkout opens.
  let claimed: CouponRow | null = null;
  if (coupon && !alreadyCounted) {
    claimed = await redeemCoupon(coupon.id);
    if (!claimed) throw new SubError('coupon', 'הקוד הזה כבר נוצל עד הסוף או הפסיק להיות פעיל. אפשר להמשיך בלי קוד.', { reason: 'exhausted' });
    coupon = claimed;
  }
  const giveBack = async () => { if (claimed) await releaseRedemption(claimed.id, claimed.redemptions_count); };

  // The first payment is the discounted price (never below MIN_CHARGE). The standing order charges
  // recurring_amount: the discounted price for 'forever', the list price for 'first'.
  let couponFields: Record<string, unknown> = {};
  if (coupon) {
    const priced = seoCouponPricing(coupon, plan.price);
    price = priced.firstAmount;
    couponFields = { coupon_id: coupon.id, recurring_amount: priced.recurringAmount, discount_amount: priced.discountAmount };
  } else if (hasCouponFields(existing)) {
    couponFields = { coupon_id: null, recurring_amount: null, discount_amount: null };   // no stale discount
  }

  let subId: string;
  if (!existing) {
    const { data, error } = await supabase.from('seo_subscriptions')
      .insert({ email, status: 'pending', amount: price, plan_id: plan.id, cycle: plan.cycle, with_page: plan.withPage, ...couponFields }).select('id').single();
    if (error || !data) { await giveBack(); throw dbError(error ?? { message: 'insert failed' }); }
    subId = (data as { id: string }).id;
  } else {
    subId = existing.id;
    const patch: Record<string, unknown> = {
      amount: price, plan_id: plan.id, cycle: plan.cycle, with_page: plan.withPage, updated_at: new Date().toISOString(), ...couponFields,
    };
    if (existing.status === 'canceled' || existing.status === 'pending') patch.status = 'pending';
    const { error } = await supabase.from('seo_subscriptions').update(patch).eq('id', subId);
    if (error) { await giveBack(); throw dbError(error); }
  }

  mark('write');
  const common = {
    itemName: seoPlanName(),
    amount: price,
    externalIdentifier: subId,
    redirectUrl: `${API_URL}/api/seo/subscription/return?ref=${subId}`,
    cancelRedirectUrl: `${API_URL}/api/seo/subscription/return?ref=${subId}&cancel=1`,
    customerEmail: email,
  };
  let opened: { redirectUrl: string };
  try {
    // Monthly = a standing order. Annual = ONE payment (installments are the customer's choice on
    // SUMIT's page), never auto-renewed.
    opened = await withTimeout(plan.cycle === 'year'
      ? beginSinglePaymentRedirect({ ...common, maxInstallments: 12 })
      : beginRecurringRedirect(common), redirectTimeoutMs());
    mark('sumit');
  } catch (e) {
    mark('sumit_failed');
    console.warn('[SUBSCRIPTION] start timings (ms)', marks);
    // SUMIT's page never opened: give the use back and take the coupon off the row, so a later retry
    // counts it again (otherwise the retry path above would reuse a use that was returned).
    if (claimed) {
      await giveBack();
      const { error: clrErr } = await supabase.from('seo_subscriptions')
        .update({ coupon_id: null, recurring_amount: null, discount_amount: null }).eq('id', subId);
      if (clrErr) console.error('[COUPON] ALERT could not clear the coupon of an unopened checkout', { subId, error: clrErr.message });
    }
    if (e instanceof SubError) throw e;   // sumit_timeout
    throw new SubError('sumit', e instanceof Error ? e.message : undefined);
  }
  // Audit row (who used which code), after the page opened; payment_id stays NULL: the subscription has no
  // payments row. Never blocks: the counter is the source of truth for the cap.
  if (claimed) await recordRedemption(claimed.id, email, null);
  console.log('[SUBSCRIPTION] start timings (ms)', marks);
  return opened;
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

  // `amount` is what THIS payment must cover: the (possibly discounted) checkout price until the first payment
  // of a monthly plan is verified, then the standing order's price (moved there below). So renewals of a
  // 'first' coupon must be the list price, those of a 'forever' coupon the discounted price; less is refused.
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

  // A subscription belongs to ONE SUMIT customer: a payment by a different customer never moves it.
  if (row.sumit_customer_id && extra.sumitCustomerId && String(row.sumit_customer_id) !== String(extra.sumitCustomerId)) {
    console.error('[SUBSCRIPTION] ALERT payment from a different SUMIT customer than this subscription — refusing', { id: row.id, payment: payment.sumitPaymentId });
    await supabase.from('seo_subscription_events').delete().eq('subscription_id', row.id).eq('sumit_payment_id', payment.sumitPaymentId);
    return 'conflict';
  }

  const current = stateOf(row);
  if (sufficient) {
    const { state, ignored } = applyChargeOk(current, now, planOf(row).months);
    if (ignored) {
      console.error('[SUBSCRIPTION] payment on a canceled subscription — needs a human (refund?)', { id: row.id, payment: payment.sumitPaymentId });
      return 'ignored';
    }
    try {
      // A monthly coupon checkout: from now on the payments to expect are the standing order's.
      const due = recurringAmountOf(row);
      const moveAmount = autoRenews(row) && row.recurring_amount != null && Math.abs(due - Number(row.amount)) > 0.001;
      await saveState(row, state, {
        needs_manual_cancel: false,
        ...(moveAmount ? { amount: due } : {}),
        ...(extra.sumitCustomerId ? { sumit_customer_id: extra.sumitCustomerId } : {}),
        ...(extra.sumitRecurringItemId ? { sumit_recurring_item_id: extra.sumitRecurringItemId } : {}),
      });
    } catch (e) {
      // The payment id was claimed above but nothing was applied. Release the claim so SUMIT's retry (or
      // the customer reloading the return page) applies it, instead of being answered "duplicate" forever.
      await supabase.from('seo_subscription_events').delete().eq('subscription_id', row.id).eq('sumit_payment_id', payment.sumitPaymentId);
      throw e;
    }
    // A monthly plan is only a subscription if SUMIT holds a standing order. Without its id nothing will charge
    // next month and we cannot cancel it automatically: say so loudly (task #39), the customer still got the month they paid for.
    const customerId = extra.sumitCustomerId ?? row.sumit_customer_id;
    let standingOrderId: string | null = extra.sumitRecurringItemId ?? row.sumit_recurring_item_id;
    // The standing order, created by SUMIT's recurring API on the card the customer just used
    // (sumitRecurring.ts). Once per subscription: this code runs only for the FIRST time a payment
    // id is seen (replay guard above), and only while no standing order is on record. It starts
    // charging at the end of the period that was just paid. Off unless SUMIT_STANDING_ORDER=after_payment.
    if (planOf(row).cycle === 'month' && !standingOrderId && customerId && state.currentPeriodEnd && standingOrderAfterPayment()) {
      const so = await createStandingOrder({ customerId, itemName: 'קידום העסק בגוגל – מנוי חודשי', amount: recurringAmountOf(row), firstCharge: state.currentPeriodEnd }, now);
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

/**
 * Would cancelling now return the first payment (decision 17.11, seoRefund.ts)? Before migration 051
 * (no refund table) the answer is always no: nothing is offered that the server cannot record.
 */
export async function refundOfferFor(row: SubRow, now = new Date()): Promise<RefundOffer> {
  const unavailable: RefundOffer = { eligible: false, amount: null, paymentId: null, until: null, reason: 'unavailable' };
  const { data: prior, error: pErr } = await supabase.from('seo_refund_requests').select('id').eq('email', row.email).limit(1);
  if (pErr) return unavailable;
  const { data: ev, error: eErr } = await supabase.from('seo_subscription_events')
    .select('kind, sumit_payment_id, amount, created_at').eq('subscription_id', row.id);
  if (eErr) return unavailable;
  return refundOffer(row.status, (ev ?? []) as ChargeEvent[], ((prior ?? []) as unknown[]).length > 0, now);
}

/**
 * Cancel within the refund window: the request is recorded FIRST (the unique index on email makes it
 * once per account even under a double click), then the standing order is stopped and access ends now.
 * Nothing is refunded by the server: the owner refunds in SUMIT and marks it in the admin panel.
 * Returns null when the request could not be claimed (another one exists): the caller falls back to
 * the ordinary cancel.
 */
async function cancelWithRefund(row: SubRow, offer: RefundOffer, now: Date): Promise<(SubRow & { refunded: number }) | null> {
  const { data: req, error: rErr } = await supabase.from('seo_refund_requests').insert({
    email: row.email, subscription_id: row.id, sumit_payment_id: offer.paymentId, amount: offer.amount, requested_at: now.toISOString(),
  }).select('id').maybeSingle();
  if (rErr) {
    if ((rErr as { code?: string }).code === '23505') return null;
    throw dbError(rErr);
  }
  const reqId = (req as { id?: string } | null)?.id ?? null;
  try {
    const stopped = autoRenews(row) && row.sumit_recurring_item_id ? await stopStandingOrder(row) : true;
    await saveState(row, { status: 'canceled', currentPeriodEnd: now, cancelAtPeriodEnd: false },
      { needs_manual_cancel: !stopped, ...(stopped && row.sumit_recurring_item_id ? { sumit_recurring_item_id: null } : {}) });
  } catch (e) {
    // Nothing changed for the customer: release the request so they can try again.
    if (reqId) await supabase.from('seo_refund_requests').delete().eq('id', reqId);
    throw e;
  }
  await supabase.from('seo_subscription_events').insert({ subscription_id: row.id, kind: 'canceled' });
  await syncAddonPage(row.email);
  console.error('[SUBSCRIPTION] ALERT refund owed — refund it in SUMIT and mark it in the admin panel', { email: row.email, amount: offer.amount, payment: offer.paymentId });
  await sendRefundMails({ email: row.email, amount: offer.amount ?? 0, paymentId: offer.paymentId, cycle: row.cycle === 'year' ? 'year' : 'month' });
  return { ...((await getById(row.id)) as SubRow), refunded: offer.amount ?? 0 };
}

/**
 * Cancels the account's subscription. With `refund: true` (the customer's own cancel button) a cancel
 * inside the refund window ends the subscription now and records a full refund; otherwise (and for an
 * account deletion) it is the ordinary cancel: renewal stops, access lasts to the end of the period.
 */
export async function cancelSubscription(email: string, now = new Date(), opts: { refund?: boolean } = {}): Promise<SubRow & { refunded?: number }> {
  const row = await getSubscription(email);
  if (!row) throw new SubError('no_subscription');
  if (opts.refund && row.status !== 'canceled') {
    const offer = await refundOfferFor(row, now);
    if (offer.eligible) {
      const done = await cancelWithRefund(row, offer, now);
      if (done) return done;
    }
  }
  if (row.status === 'canceled') {
    // Access already ended, but SUMIT may still hold the standing order (a stop that failed earlier):
    // the customer must always be able to stop the charges themselves.
    if (!row.sumit_recurring_item_id || !autoRenews(row)) throw new SubError('no_subscription');
    if (!(await stopStandingOrder(row))) throw new SubError('sumit', 'לא הצלחנו לעצור את החיוב. נסו שוב או פנו אלינו.');
    return (await getById(row.id)) as SubRow;
  }

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
  // A stopped order's id is cleared, so a later re-subscription creates a new one instead of trusting a dead id.
  await saveState(row, next, { needs_manual_cancel: !stopped, ...(stopped && row.sumit_recurring_item_id ? { sumit_recurring_item_id: null } : {}) });
  await supabase.from('seo_subscription_events').insert({ subscription_id: row.id, kind: 'canceled' });
  return (await getById(row.id)) as SubRow;
}

/**
 * Stops the SUMIT standing order of a monthly subscription and clears its id. On failure the row is
 * marked needs_manual_cancel (admin health panel) and false is returned. Never throws.
 */
async function stopStandingOrder(row: SubRow): Promise<boolean> {
  if (!row.sumit_recurring_item_id) return true;
  const ok = await cancelRecurring(row.sumit_customer_id, row.sumit_recurring_item_id).catch(() => false);
  const { error } = await supabase.from('seo_subscriptions')
    .update(ok ? { sumit_recurring_item_id: null, needs_manual_cancel: false } : { needs_manual_cancel: true }).eq('id', row.id);
  if (error) console.error('[SUBSCRIPTION] standing order stop not recorded:', row.id, error.message);
  if (!ok) console.error('[SUBSCRIPTION] ALERT could not stop the standing order in SUMIT — stop it by hand', { id: row.id, email: row.email });
  return ok;
}

// ─── Refund requests (admin) ─────────────────────────────────────────────────

export interface RefundRequestRow {
  id: string; email: string; subscription_id: string | null; sumit_payment_id: string | null;
  amount: number; requested_at: string; status: 'pending' | 'refunded' | 'rejected'; handled_at: string | null; note: string | null;
}

/** Newest first. Throws SubError('not_migrated') before migration 051. */
export async function listRefundRequests(limit = 100): Promise<RefundRequestRow[]> {
  const { data, error } = await supabase.from('seo_refund_requests')
    .select('id, email, subscription_id, sumit_payment_id, amount, requested_at, status, handled_at, note')
    .order('requested_at', { ascending: false }).limit(limit);
  if (error) throw dbError(error);
  return (data ?? []) as RefundRequestRow[];
}

/** The admin marks a request refunded (or rejected) after handling it in SUMIT. Only a pending one changes. */
export async function markRefundRequest(id: string, status: 'refunded' | 'rejected', note: string | null, now = new Date()): Promise<boolean> {
  const { data, error } = await supabase.from('seo_refund_requests')
    .update({ status, handled_at: now.toISOString(), note: note ? note.slice(0, 500) : null })
    .eq('id', id).eq('status', 'pending').select('id');
  if (error) throw dbError(error);
  return ((data ?? []) as unknown[]).length > 0;
}

/** The subscription that owns this SUMIT customer (a renewal charge reported without our reference). */
export async function findBySumitCustomer(customerId: string): Promise<SubRow | null> {
  const { data, error } = await supabase.from('seo_subscriptions').select(COLS).eq('sumit_customer_id', customerId).limit(2);
  if (error) throw dbError(error);
  const rows = (data ?? []) as SubRow[];
  return rows.length === 1 ? rows[0] : null;   // ambiguous -> nobody: a human looks
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
      // Access ended: nothing may be charged any more. (A renewal that SUMIT did charge but never
      // reported would otherwise keep billing a customer who no longer has the product.)
      if (next.status === 'canceled' && autoRenews(row)) await stopStandingOrder(row);
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
