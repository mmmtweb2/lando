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
  SubError, SubRow, applyVerifiedPayment, autoRenews, cancelSubscription, getSubscription, planOf, startSubscription,
} from '../services/seoSubscription.service';

const APP_URL = (process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(res: Response, e: unknown): void {
  if (e instanceof SubError) {
    switch (e.code) {
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
  if (!row.with_page) return { included: false, pageId: null, status: null };
  const info = await addonPageInfo(row.email);
  return { included: true, pageId: info.pageId, status: info.status };
}

/** GET /api/seo/subscription — what the dashboard card shows. Never fails the page. */
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
        renews: autoRenews(row),   // annual: false, it ends on its date unless a new plan is bought
        page: await pageState(row),
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
    const started = await startSubscription(email, planId);
    void logEvent({ event: 'payment_started', email });
    res.json(started);
  } catch (e) { fail(res, e); }
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }
  try {
    const row = await cancelSubscription(email);
    res.json({ status: row.status, currentPeriodEnd: row.current_period_end, cancelAtPeriodEnd: row.cancel_at_period_end });
  } catch (e) { fail(res, e); }
}

/** Verifies the payment with SUMIT server-to-server, then applies it. Never trusts the caller. */
async function verifyAndApply(subscriptionId: string, bag: Record<string, unknown>): Promise<string> {
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
      // SUMIT's redirect sends OG-CustomerID (its documented return parameters are OG-*); a webhook may send
      // CustomerID; failing both, the customer id of the verified payment itself.
      sumitCustomerId: pickField(bag, 'OG-CustomerID', 'CustomerID', 'Customer.ID') ?? verified.customerId,
      sumitRecurringItemId: pickField(bag, 'RecurringCustomerItemIDs[0]', 'OG-RecurringCustomerItemIDs', 'RecurringCustomerItemID', 'RecurringItemID'),
    },
  );
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
  const ref = pickField(bag, 'ExternalIdentifier', 'ref');
  if (!ref || !UUID.test(ref)) { res.status(200).json({ ok: true, applied: 'no_ref' }); return; }
  try {
    const applied = await verifyAndApply(ref, bag);
    void recordHeartbeat('sumit_webhook', null);
    res.status(200).json({ ok: true, applied });
  } catch (e) {
    console.error('[SUBSCRIPTION] webhook handling failed:', e instanceof Error ? e.message : e);
    void recordHeartbeat('sumit_webhook', e);
    res.status(500).json({ ok: false });   // SUMIT may retry
  }
}
