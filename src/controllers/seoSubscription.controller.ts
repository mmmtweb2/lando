import { logEvent } from '../services/journey.service';
import { recordHeartbeat } from '../services/opsMetrics.service';
import { Request, Response } from 'express';
import crypto from 'crypto';
import { seoPlanName, seoSubscriptionEnabled, seoTestMode } from '../config/seoPlan';
import { SEO_MONTHLY_PRICE, publicSeoCatalog } from '../config/seoCatalog';
import { getPayment } from '../services/summit.service';
import { addonPageInfo } from '../services/seoPageAddon.service';
import { evaluateBinding, noteUnverifiable } from '../services/paymentBinding';
import { pickField } from '../services/sumitRecurring';
import { diagLog, keysOf } from '../services/sumitDiag';
import {
  SubError, SubRow, applyVerifiedPayment, autoRenews, cancelSubscription, findBySumitCustomer, getSubscription, planOf, pricingView, refundOfferFor, startSubscription,
} from '../services/seoSubscription.service';

const APP_URL = (process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const RENEWAL_DAY_MS = 2 * 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res: Response, e: unknown): void {
  if (e instanceof SubError) {
    switch (e.code) {
      case 'coupon': res.status(400).json({ error: e.message, code: 'coupon' }); return;
      case 'bad_plan': res.status(400).json({ error: 'תוכנית לא מוכרת.', code: 'bad_plan' }); return;
      case 'disabled': res.status(503).json({ error: 'המנוי החודשי עדיין לא הופעל.', code: 'subscription_disabled' }); return;
      case 'not_migrated': res.status(503).json({ error: 'המנוי החודשי עדיין לא הופעל.', code: 'subscription_not_migrated' }); return;
      case 'already_has_access': res.status(409).json({ error: 'המוצר כבר פעיל בחשבון שלך, אין צורך במנוי.', code: 'already_has_access' }); return;
      case 'already_subscribed': res.status(409).json({ error: 'המנוי כבר פעיל.', code: 'already_subscribed' }); return;
      case 'no_subscription': res.status(404).json({ error: 'אין מנוי פעיל לביטול.', code: 'no_subscription' }); return;
      case 'sumit': res.status(502).json({ error: e.message === 'sumit' ? 'פתיחת התשלום נכשלה. נסו שוב.' : e.message }); return;
      default: break;
    }
  }
  console.error('[SUBSCRIPTION] unexpected:', e);
  res.status(500).json({ error: 'משהו השתבש. נסו שוב.' });
}

/** The included landing page: whether the plan has one, and which page / what state. */
async function pageState(row: SubRow) {
  const info = await addonPageInfo(row.email);
  return { included: true, pageId: info.pageId, status: info.status };
}

/** GET /api/seo/subscription — what the dashboard card shows. Never fails the page. */
async function refundView(row: SubRow): Promise<{ eligible: boolean; amount: number | null; until: string | null }> {
  try {
    const o = await refundOfferFor(row);
    return { eligible: o.eligible, amount: o.eligible ? o.amount : null, until: o.eligible && o.until ? o.until.toISOString() : null };
  } catch { return { eligible: false, amount: null, until: null }; }
}

export async function getStatus(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  const enabled = seoSubscriptionEnabled();
  let sub = null;
  try {
    const row = await getSubscription(email);
    if (row && row.status !== 'pending') {
      sub = {
        status: row.status,
        currentPeriodEnd: row.current_period_end,
        cancelAtPeriodEnd: row.cancel_at_period_end,
        planId: planOf(row).id,
        cycle: planOf(row).cycle,
        withPage: planOf(row).withPage,
        // Annual: false, it ends on its date. Monthly: true only while SUMIT holds a standing order we know of,
        // so the screen never promises a next charge that nothing will make.
        renews: autoRenews(row) && Boolean(row.sumit_recurring_item_id) && !row.cancel_at_period_end,
        // The renewal day itself: SUMIT charges some time during the day, so a just-ended period is not
        // yet a failed charge. The card says "being renewed" instead of "re-enter your card".
        renewalPending: row.status === 'past_due' && Boolean(row.sumit_recurring_item_id) && !!row.current_period_end
          && Date.now() < new Date(row.current_period_end).getTime() + RENEWAL_DAY_MS,
        page: await pageState(row),
        // Cancelling now returns the first payment in full (14 days from it, once per account). The card
        // says which case applies, with the amount, before the customer confirms.
        refund: await refundView(row),
        // What was paid and what the next charge will be, when a coupon priced the subscription (part 148).
        pricing: pricingView(row),
      };
    }
  } catch { /* not migrated / db hiccup: show "no subscription" */ }
  // `price` stays the base monthly price (older clients); `catalog` carries all four plans.
  // `testMode`: only the accounts listed in SEO_TEST_EMAILS (while SEO_TEST_PRICE is valid) see true; everyone else false.
  res.json({ enabled, testMode: enabled && seoTestMode(email), planName: seoPlanName(), price: enabled ? SEO_MONTHLY_PRICE : null, catalog: publicSeoCatalog(), subscription: sub });
}

/** GET /api/seo/plans — the plan catalog, read-only. Public prices, nothing account-specific. */
export function getPlans(_req: Request, res: Response): void {
  res.json({ enabled: seoSubscriptionEnabled(), planName: seoPlanName(), ...publicSeoCatalog() });
}

export async function start(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  try {
    const planId = typeof req.body?.plan === 'string' ? req.body.plan : 'monthly';
    // Optional discount code (README part 148). Only the code is taken from the browser: the server checks
    // it, prices the checkout and counts the use itself.
    const couponCode = typeof req.body?.couponCode === 'string' ? req.body.couponCode.slice(0, 64) : undefined;
    const started = await startSubscription(email, planId, { couponCode });
    void logEvent({ event: 'payment_started', email });
    res.json(started);
  } catch (e) { fail(res, e); }
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  try {
    const row = await cancelSubscription(email, new Date(), { refund: true });
    res.json({ status: row.status, currentPeriodEnd: row.current_period_end, cancelAtPeriodEnd: row.cancel_at_period_end, refunded: row.refunded ?? null });
  } catch (e) { fail(res, e); }
}

/** Verifies the payment with SUMIT server-to-server, then applies it. Never trusts the caller. */
/**
 * `fromSumit` is true only for the secret-authenticated webhook. The return URL is opened by the BROWSER,
 * so nothing in it but the payment id (verified with SUMIT) and our own reference is trusted: a payer who
 * rewrote it could otherwise attach someone else's SUMIT customer or standing order to their subscription.
 */
async function verifyAndApply(subscriptionId: string, bag: Record<string, unknown>, fromSumit = false): Promise<string> {
  const sumitPaymentId = pickField(bag, 'OG-PaymentID', 'OGPaymentID', 'PaymentID', 'Payment.ID');
  diagLog('return/webhook keys', keysOf(bag));   // SUMIT_DIAG=true only; names of the parameters, never values
  if (!sumitPaymentId) return 'no_payment_id';
  const verified = await getPayment(sumitPaymentId);
  if (!verified) return 'unverified';   // fail closed: SUMIT could not confirm it
  // Bind to THIS subscription: the checkout was opened with ExternalIdentifier = seo_subscriptions.id
  // (on the payment and on the SUMIT customer). Any other valid payment of enough money is not ours.
  const bound = evaluateBinding(verified.externalIdentifiers, subscriptionId);
  if (!bound.ok) {
    console.error('[SUBSCRIPTION] payment not bound to this subscription — refusing', { subscriptionId, payment: sumitPaymentId, state: bound.state });
    return 'binding_mismatch';
  }
  if (bound.state === 'unverifiable') noteUnverifiable('subscription', subscriptionId);
  return applyVerifiedPayment(
    subscriptionId,
    { sumitPaymentId, valid: verified.valid, amount: verified.amount },
    {
      // The customer comes from the VERIFIED payment. Only the webhook (SUMIT itself) may fill it in when the
      // payment record has none, or name a standing order.
      sumitCustomerId: verified.customerId ?? (fromSumit ? pickField(bag, 'CustomerID', 'Customer.ID', 'OG-CustomerID') : undefined),
      sumitRecurringItemId: fromSumit ? pickField(bag, 'RecurringCustomerItemIDs[0]', 'OG-RecurringCustomerItemIDs', 'RecurringCustomerItemID', 'RecurringItemID') : undefined,
    },
  );
}

/**
 * A standing-order charge may reach us without our reference (SUMIT copies ExternalIdentifier onto the
 * customer, not necessarily onto each recurring charge). The SUMIT customer id, read from the VERIFIED
 * payment, then identifies the subscription; a payment that names a different reference is refused.
 */
async function applyByCustomer(bag: Record<string, unknown>): Promise<string> {
  const sumitPaymentId = pickField(bag, 'OG-PaymentID', 'OGPaymentID', 'PaymentID', 'Payment.ID', 'ID');
  if (!sumitPaymentId) return 'no_ref';
  const verified = await getPayment(sumitPaymentId);
  if (!verified) return 'unverified';
  const customerId = verified.customerId ?? pickField(bag, 'CustomerID', 'Customer.ID', 'OG-CustomerID');
  const row = customerId ? await findBySumitCustomer(customerId) : null;
  if (!row) {
    if (verified.valid) console.error('[SUBSCRIPTION] ALERT a SUMIT charge arrived that matches no subscription — check it by hand', { payment: sumitPaymentId });
    return 'no_ref';
  }
  if (verified.externalIdentifiers.length && !evaluateBinding(verified.externalIdentifiers, row.id).ok) {
    console.error('[SUBSCRIPTION] payment names another reference — refusing', { subscriptionId: row.id, payment: sumitPaymentId });
    return 'binding_mismatch';
  }
  return applyVerifiedPayment(row.id, { sumitPaymentId, valid: verified.valid, amount: verified.amount }, { sumitCustomerId: customerId });
}

/** GET /api/seo/subscription/return — the browser comes back from SUMIT's payment page. */
export async function subscriptionReturn(req: Request, res: Response): Promise<void> {
  const to = (s: string) => res.redirect(`${APP_URL}/dashboard?seo_subscription=${s}`);
  const ref = typeof req.query.ref === 'string' ? req.query.ref : '';
  if (!UUID.test(ref)) { to('error'); return; }
  if (req.query.cancel === '1') { to('cancel'); return; }
  try {
    const outcome = await verifyAndApply(ref, req.query as Record<string, unknown>);
    to(outcome === 'activated' || outcome === 'duplicate' ? 'ok' : 'review');
  } catch (e) {
    console.error('[SUBSCRIPTION] return handling failed:', e instanceof Error ? e.message : e);
    to('review');
  }
}

function secretOk(given: unknown): boolean {
  const want = process.env.SEO_SUBSCRIPTION_WEBHOOK_SECRET;
  if (!want || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * POST /api/seo/subscription/webhook?secret=… — a SUMIT trigger reporting a (renewal) charge.
 * The payload is only a pointer: the payment is re-read from SUMIT before anything changes.
 */
export async function subscriptionWebhook(req: Request, res: Response): Promise<void> {
  if (!secretOk(req.query.secret)) { res.status(401).json({ error: 'unauthorized' }); return; }
  const bag: Record<string, unknown> = { ...(req.query as Record<string, unknown>), ...(typeof req.body === 'object' && req.body ? req.body : {}) };
  diagLog('webhook keys', keysOf(bag));   // SUMIT_DIAG=true only; names, never values
  const ref = pickField(bag, 'ExternalIdentifier', 'ref');
  try {
    const applied = ref && UUID.test(ref) ? await verifyAndApply(ref, bag, true) : await applyByCustomer(bag);
    void recordHeartbeat('sumit_webhook', null);
    res.status(200).json({ ok: true, applied });
  } catch (e) {
    console.error('[SUBSCRIPTION] webhook handling failed:', e instanceof Error ? e.message : e);
    void recordHeartbeat('sumit_webhook', e);
    res.status(500).json({ ok: false });   // SUMIT may retry
  }
}
