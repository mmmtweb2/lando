// Run: npx tsx scripts/test-seo-subscription.ts
// Env must be set BEFORE the app modules load. tsx/esbuild hoists `import` statements above plain
// statements, so this lives in a side-effect module that is imported first.
import './_env-seo-subscription';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import { cancel, getPlans, getStatus, start, subscriptionReturn, subscriptionWebhook } from '../src/controllers/seoSubscription.controller';
import { SubError, getSubscription, sweepSubscriptions } from '../src/services/seoSubscription.service';
import { getEntitlements } from '../src/services/entitlements.service';

type Row = Record<string, any>;
const db: Record<string, Row[]> = { seo_subscriptions: [], seo_subscription_events: [], user_products: [], journey_events: [], payments: [], seo_addon_pages: [], landing_pages: [] };
const UNIQUE: Record<string, string[]> = { seo_subscriptions: ['email'], seo_subscription_events: ['sumit_payment_id'] };
let seq = 0;
let missingTable = false;
(supabase as any).from = (table: string) => {
  const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {}; let onConflict: string[] = [];
  const rows = () => db[table].filter(r => f.every(fn => fn(r)));
  const run = (): any => {
    if (missingTable && table.startsWith('seo_subscription')) return { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } };
    if (op === 'insert') {
      for (const col of UNIQUE[table] ?? []) {
        if (patch[col] != null && db[table].some(r => r[col] === patch[col])) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      const row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, ...patch };
      db[table].push(row); return { data: [row], error: null };
    }
    if (op === 'upsert') {
      const ex = db[table].find(r => onConflict.every(c => r[c] === patch[c]));
      if (ex) Object.assign(ex, patch); else db[table].push({ ...patch });
      return { data: null, error: null };
    }
    if (op === 'update') { rows().forEach(r => Object.assign(r, patch)); return { data: null, error: null }; }
    return { data: rows(), error: null };
  };
  const q: any = {
    select: () => q, limit: () => q,
    insert: (p: Row) => { op = 'insert'; patch = p; return q; },
    update: (p: Row) => { op = 'update'; patch = p; return q; },
    upsert: (p: Row, o: { onConflict: string }) => { op = 'upsert'; patch = p; onConflict = o.onConflict.split(','); return q; },
    eq: (k: string, v: unknown) => { f.push(r => r[k] === v); return q; },
    in: (k: string, vs: unknown[]) => { f.push(r => vs.includes(r[k])); return q; },
    maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    single: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (ok: any) => ok(run()),
  };
  return q;
};

// ── fake SUMIT ──
const sumitCalls: Array<{ path: string; body: any }> = [];
const payments: Record<string, { valid: boolean; amount: number; ext?: unknown }> = {};
let beginFails = false;
let cancelOk = true;
(globalThis as any).fetch = async (url: string, init: any) => {
  const path = new URL(url).pathname;
  const body = JSON.parse(init.body);
  sumitCalls.push({ path, body });
  const json = (o: unknown) => ({ json: async () => o });
  if (path === '/billing/payments/beginredirect/') {
    return beginFails ? json({ Status: 1, UserErrorMessage: 'כרטיס לא נתמך' }) : json({ Status: 0, Data: { RedirectURL: 'https://pay.sumit/x' } });
  }
  if (path === '/billing/payments/get/') {
    const p = payments[String(body.PaymentID)];
    return p ? json({ Status: 0, Data: { Payment: { ValidPayment: p.valid, Amount: p.amount, Status: p.valid ? '000' : '1', ...(p.ext !== undefined ? { ExternalIdentifier: p.ext } : {}) } } }) : json({ Status: 1, UserErrorMessage: 'not found' });
  }
  if (path === '/billing/recurring/cancel/') return json(cancelOk ? { Status: 0 } : { Status: 1, UserErrorMessage: 'nope' });
  throw new Error('unexpected SUMIT call ' + path);
};

function res() {
  const r: any = { code: 200, body: undefined, redirected: '' };
  r.status = (c: number) => { r.code = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; };
  r.redirect = (u: string) => { r.redirected = u; return r; };
  return r;
}
const EMAIL = 'o@x.co';
const req = (extra: Row = {}) => ({ authEmail: EMAIL, query: {}, body: {}, ...extra }) as any;

(async () => {
  // 1. off by default: nothing can be started, status says disabled
  let r = res(); await getStatus(req(), r);
  assert.equal(r.body.enabled, false); assert.equal(r.body.subscription, null);
  r = res(); await start(req(), r);
  assert.equal(r.code, 503); assert.equal(r.body.code, 'subscription_disabled');
  assert.equal(sumitCalls.length, 0, 'disabled -> SUMIT never called');
  process.env.SEO_SUBSCRIPTION_ENABLED = 'true';
  r = res(); await start(req({ body: { plan: 'bogus' } }), r);
  assert.equal(r.code, 400); assert.equal(r.body.code, 'bad_plan');
  assert.equal(sumitCalls.length, 0, 'unknown plan -> SUMIT never called');

  // 2. start: a pending row, and a SUMIT request that says monthly + the exact price
  beginFails = true;
  r = res(); await start(req(), r);
  assert.equal(r.code, 502); assert.equal(r.body.error, 'כרטיס לא נתמך');
  beginFails = false;
  r = res(); await start(req(), r);
  assert.equal(r.code, 200); assert.equal(r.body.redirectUrl, 'https://pay.sumit/x');
  assert.equal(db.seo_subscriptions.length, 1, 'one row per account, reused on retry');
  const sub = db.seo_subscriptions[0];
  assert.equal(sub.status, 'pending'); assert.equal(sub.amount, 250);
  const begin = sumitCalls.filter(c => c.path === '/billing/payments/beginredirect/').pop()!.body;
  assert.equal(begin.Items[0].UnitPrice, 250); assert.equal(begin.Items[0].Duration_Months, 1);
  assert.equal(begin.ExternalIdentifier, sub.id);
  assert.equal(begin.RedirectURL, `https://api.test/api/seo/subscription/return?ref=${sub.id}`);
  assert.equal(begin.VATIncluded, true);
  assert.equal(db.user_products.length, 0, 'pending grants nothing');
  assert.equal((await getEntitlements(EMAIL)).seo_autopilot, false);

  // 3. a manual grant is not billed for
  db.user_products.push({ email: 'g@x.co', product: 'seo_autopilot', status: 'active', current_period_end: null, source: 'manual' });
  r = res(); await start(req({ authEmail: 'g@x.co' }), r);
  assert.equal(r.code, 409); assert.equal(r.body.code, 'already_has_access');
  db.user_products.pop();

  // 4. return from SUMIT: verified + sufficient -> active for one month; replay and underpay change nothing
  r = res(); await subscriptionReturn({ query: { ref: 'nope' } } as any, r);
  assert.equal(r.redirected, 'https://app.test/dashboard?seo_subscription=error');
  r = res(); await subscriptionReturn({ query: { ref: sub.id, cancel: '1' } } as any, r);
  assert.equal(r.redirected, 'https://app.test/dashboard?seo_subscription=cancel');
  assert.equal(db.user_products.length, 0);
  r = res(); await subscriptionReturn({ query: { ref: sub.id, 'OG-PaymentID': '777' } } as any, r);
  assert.equal(r.redirected, 'https://app.test/dashboard?seo_subscription=review', 'SUMIT does not know the payment -> fail closed');
  assert.equal(db.user_products.length, 0);
  payments['500'] = { valid: true, amount: 50 };
  r = res(); await subscriptionReturn({ query: { ref: sub.id, 'OG-PaymentID': '500' } } as any, r);
  assert.equal(r.redirected, 'https://app.test/dashboard?seo_subscription=review');
  assert.equal(db.user_products.length, 0, 'underpaid -> not activated');
  payments['501'] = { valid: true, amount: 250 };
  r = res(); await subscriptionReturn({ query: { ref: sub.id, 'OG-PaymentID': '501', CustomerID: '42', 'RecurringCustomerItemIDs[0]': '9001' } } as any, r);
  assert.equal(r.redirected, 'https://app.test/dashboard?seo_subscription=ok');
  assert.equal(db.seo_subscriptions[0].status, 'active');
  assert.equal(db.seo_subscriptions[0].sumit_customer_id, '42'); assert.equal(db.seo_subscriptions[0].sumit_recurring_item_id, '9001');
  const end1 = new Date(db.seo_subscriptions[0].current_period_end).getTime();
  assert.ok(end1 > Date.now() + 27 * 86400000 && end1 < Date.now() + 32 * 86400000, 'about one month');
  assert.deepEqual({ ...db.user_products[0] }, { email: EMAIL, product: 'seo_autopilot', status: 'active', current_period_end: db.seo_subscriptions[0].current_period_end, source: 'sumit' });
  assert.equal((await getEntitlements(EMAIL)).seo_autopilot, true);
  r = res(); await subscriptionReturn({ query: { ref: sub.id, 'OG-PaymentID': '501' } } as any, r);
  assert.equal(r.redirected, 'https://app.test/dashboard?seo_subscription=ok');
  assert.equal(new Date(db.seo_subscriptions[0].current_period_end).getTime(), end1, 'replaying the same payment id extends nothing');
  // someone else's subscription cannot be extended with a payment that was already consumed
  db.seo_subscriptions.push({ id: '00000000-0000-4000-8000-0000000000aa', email: 'v@x.co', status: 'pending', amount: 250, current_period_end: null, cancel_at_period_end: false });
  r = res(); await subscriptionReturn({ query: { ref: '00000000-0000-4000-8000-0000000000aa', 'OG-PaymentID': '501' } } as any, r);
  assert.equal(db.seo_subscriptions[1].status, 'pending', 'a consumed payment id cannot activate another account');
  db.seo_subscriptions.pop();

  // 4b. BINDING to this subscription (payment echoes the ExternalIdentifier we sent = subscription id)
  const OTHER = '00000000-0000-4000-8000-0000000000bb';
  db.seo_subscriptions.push({ id: OTHER, email: 'w@x.co', status: 'pending', amount: 250, current_period_end: null, cancel_at_period_end: false });
  payments['510'] = { valid: true, amount: 250, ext: sub.id };            // a valid payment that belongs to ANOTHER checkout
  r = res(); await subscriptionReturn({ query: { ref: OTHER, 'OG-PaymentID': '510' } } as any, r);
  assert.equal(r.redirected, 'https://app.test/dashboard?seo_subscription=review');
  assert.equal(db.seo_subscriptions[1].status, 'pending', 'a valid payment bound to a different subscription activates nothing');
  assert.equal(db.seo_subscription_events.filter(e => e.sumit_payment_id === '510').length, 0, 'and burns no replay-guard slot');
  payments['511'] = { valid: true, amount: 250, ext: OTHER.toUpperCase() };  // matches (case-insensitive)
  r = res(); await subscriptionReturn({ query: { ref: OTHER, 'OG-PaymentID': '511' } } as any, r);
  assert.equal(r.redirected, 'https://app.test/dashboard?seo_subscription=ok'); assert.equal(db.seo_subscriptions[1].status, 'active');
  // strict mode: a payment with no identifier at all is refused; default mode accepts it (unverifiable)
  db.seo_subscriptions[1].status = 'pending';
  payments['512'] = { valid: true, amount: 250 };
  process.env.SUMIT_REQUIRE_BINDING = 'true';
  r = res(); await subscriptionReturn({ query: { ref: OTHER, 'OG-PaymentID': '512' } } as any, r);
  assert.equal(r.redirected, 'https://app.test/dashboard?seo_subscription=review'); assert.equal(db.seo_subscriptions[1].status, 'pending');
  delete process.env.SUMIT_REQUIRE_BINDING;
  const warn0 = console.warn; console.warn = () => undefined;
  r = res(); await subscriptionReturn({ query: { ref: OTHER, 'OG-PaymentID': '512' } } as any, r);
  console.warn = warn0;
  assert.equal(r.redirected, 'https://app.test/dashboard?seo_subscription=ok'); assert.equal(db.seo_subscriptions[1].status, 'active');
  // cross-product: an id that already settled a ONE-TIME payment cannot activate a subscription
  db.seo_subscriptions[1].status = 'pending';
  db.payments.push({ id: 'pay-1', status: 'paid', sumit_payment_id: '513' });
  payments['513'] = { valid: true, amount: 250, ext: OTHER };
  r = res(); await subscriptionReturn({ query: { ref: OTHER, 'OG-PaymentID': '513' } } as any, r);
  assert.equal(r.redirected, 'https://app.test/dashboard?seo_subscription=review'); assert.equal(db.seo_subscriptions[1].status, 'pending');
  assert.equal(db.seo_subscription_events.filter(e => e.sumit_payment_id === '513').length, 0);
  db.payments.pop();
  // (the webhook is bound the same way: see the 'binding_mismatch' check in section 6)
  db.seo_subscriptions.pop();

  // 5. status + already subscribed
  r = res(); await getStatus(req(), r);
  assert.equal(r.body.enabled, true); assert.equal(r.body.price, 250); assert.equal(r.body.subscription.status, 'active');
  assert.ok(!('sumit_customer_id' in r.body.subscription) && !('id' in r.body.subscription), 'no internal ids leak');
  r = res(); await start(req(), r);
  assert.equal(r.code, 409); assert.equal(r.body.code, 'already_subscribed');

  // 6. webhook: secret required; payload is only a pointer; renewal extends from the current end
  process.env.SEO_SUBSCRIPTION_WEBHOOK_SECRET = 'topsecret';
  r = res(); await subscriptionWebhook({ query: { secret: 'wrong' }, body: {} } as any, r);
  assert.equal(r.code, 401);
  r = res(); await subscriptionWebhook({ query: {}, body: {} } as any, r);
  assert.equal(r.code, 401);
  delete process.env.SEO_SUBSCRIPTION_WEBHOOK_SECRET;
  r = res(); await subscriptionWebhook({ query: { secret: 'topsecret' }, body: {} } as any, r);
  assert.equal(r.code, 401, 'no secret configured -> closed');
  process.env.SEO_SUBSCRIPTION_WEBHOOK_SECRET = 'topsecret';
  r = res(); await subscriptionWebhook({ query: { secret: 'topsecret' }, body: { ExternalIdentifier: sub.id, 'Payment.ID': '999' } } as any, r);
  assert.equal(r.body.applied, 'unverified');
  payments['600'] = { valid: true, amount: 250 };
  r = res(); await subscriptionWebhook({ query: { secret: 'topsecret' }, body: { ExternalIdentifier: sub.id, 'Payment.ID': '600' } } as any, r);
  assert.equal(r.code, 200); assert.equal(r.body.applied, 'activated');
  const end2 = new Date(db.seo_subscriptions[0].current_period_end).getTime();
  assert.ok(end2 > end1 + 27 * 86400000, 'renewal added a month to the existing end');
  payments['601'] = { valid: false, amount: 0 };
  r = res(); await subscriptionWebhook({ query: { secret: 'topsecret' }, body: { ExternalIdentifier: sub.id, 'Payment.ID': '601' } } as any, r);
  assert.equal(r.body.applied, 'failed');
  assert.equal(db.seo_subscriptions[0].status, 'past_due');
  assert.equal((await getEntitlements(EMAIL)).seo_autopilot, true, 'a failed charge does not cut access on day one');
  payments['602'] = { valid: true, amount: 250 };
  r = res(); await subscriptionWebhook({ query: { secret: 'topsecret' }, body: { ExternalIdentifier: sub.id, 'Payment.ID': '602' } } as any, r);
  assert.equal(db.seo_subscriptions[0].status, 'active', 'a later good charge recovers');
  r = res(); await subscriptionWebhook({ query: { secret: 'topsecret' }, body: { ExternalIdentifier: 'garbage' } } as any, r);
  assert.equal(r.code, 200); assert.equal(r.body.applied, 'no_ref');
  payments['603'] = { valid: true, amount: 250, ext: '00000000-0000-4000-8000-0000000000cc' };
  r = res(); await subscriptionWebhook({ query: { secret: 'topsecret' }, body: { ExternalIdentifier: sub.id, 'Payment.ID': '603' } } as any, r);
  assert.equal(r.body.applied, 'binding_mismatch', 'webhook: a payment bound to something else is refused');

  // 6b. past_due: may re-enter a card; the OLD standing order is stopped first (no double charging)
  db.seo_subscriptions[0].status = 'past_due';
  cancelOk = false;
  r = res(); await start(req(), r);
  assert.equal(r.code, 502, 'old standing order could not be stopped -> no new one is opened');
  cancelOk = true;
  const beginsBefore = sumitCalls.filter(c => c.path === '/billing/payments/beginredirect/').length;
  r = res(); await start(req(), r);
  assert.equal(r.code, 200);
  assert.equal(sumitCalls.filter(c => c.path === '/billing/payments/beginredirect/').length, beginsBefore + 1);
  assert.equal(db.seo_subscriptions[0].sumit_recurring_item_id, null);
  db.seo_subscriptions[0].status = 'active'; db.seo_subscriptions[0].sumit_recurring_item_id = '9001';

  // 7. cancel: charges stopped at SUMIT, access stays to the end of the paid period
  cancelOk = false;
  r = res(); await cancel(req(), r);
  assert.equal(r.code, 200); assert.equal(r.body.cancelAtPeriodEnd, true); assert.equal(r.body.status, 'active');
  assert.equal(db.seo_subscriptions[0].needs_manual_cancel, true, 'SUMIT failed -> flagged for a human');
  assert.equal((await getEntitlements(EMAIL)).seo_autopilot, true);
  cancelOk = true;
  db.seo_subscriptions[0].cancel_at_period_end = false;
  r = res(); await cancel(req(), r);
  assert.equal(db.seo_subscriptions[0].needs_manual_cancel, false);
  assert.ok(sumitCalls.some(c => c.path === '/billing/recurring/cancel/' && c.body.RecurringCustomerItemID === 9001 && c.body.Customer.ID === 42));
  r = res(); await cancel(req({ authEmail: 'nobody@x.co' }), r);
  assert.equal(r.code, 404);

  // 8. sweep: ended + cancel flag -> canceled; ended without renewal -> past_due -> canceled after grace
  const row = db.seo_subscriptions[0];
  row.current_period_end = new Date(Date.now() - 86400000).toISOString();
  assert.equal(await sweepSubscriptions(), 1);
  assert.equal(row.status, 'canceled');
  assert.equal(db.user_products[0].status, 'canceled');
  assert.equal((await getEntitlements(EMAIL)).seo_autopilot, false);
  row.status = 'active'; row.cancel_at_period_end = false;
  assert.equal(await sweepSubscriptions(), 1); assert.equal(row.status, 'past_due');
  assert.equal(await sweepSubscriptions(), 0, 'nothing more to do inside the grace window');
  row.current_period_end = new Date(Date.now() - 8 * 86400000).toISOString();
  assert.equal(await sweepSubscriptions(), 1); assert.equal(row.status, 'canceled');

  // 9. a manual grant is never overwritten by a payment event
  db.user_products.length = 0;
  db.user_products.push({ email: EMAIL, product: 'seo_autopilot', status: 'active', current_period_end: null, source: 'manual' });
  row.status = 'pending'; row.current_period_end = null;
  payments['700'] = { valid: true, amount: 250 };
  r = res(); await subscriptionReturn({ query: { ref: row.id, 'OG-PaymentID': '700' } } as any, r);
  assert.equal(db.user_products[0].source, 'manual');
  assert.equal(db.user_products[0].current_period_end, null);

  // 11. the catalog (read-only) and the annual plans: ONE payment for the year, no standing order, no auto-renew
  {
    const cr: any = res(); getPlans({} as any, cr);
    const prices = Object.fromEntries(cr.body.plans.map((p: any) => [p.id, p.price]));
    assert.deepEqual(prices, { monthly: 250, monthly_page: 265, annual: 2500, annual_page: 2650 });
    const saving = Object.fromEntries(cr.body.plans.map((p: any) => [p.id, p.savingVsMonthly]));
    assert.deepEqual(saving, { monthly: 0, monthly_page: 0, annual: 500, annual_page: 530 }, 'annual = 10 months for 12');
    assert.equal(cr.body.terms.annualAutoRenew, false); assert.equal(cr.body.terms.annualRefundForRemainingMonths, false);
    assert.ok(!JSON.stringify(cr.body).match(/secret|key|password/i), 'nothing internal in the public catalog');

    const A = 'annual@x.co';
    db.user_products.length = 0;
    r = res(); await start(req({ authEmail: A, body: { plan: 'annual_page' } }), r);
    assert.equal(r.code, 200);
    const asub = db.seo_subscriptions.find(x => x.email === A)!;
    assert.equal(asub.plan_id, 'annual_page'); assert.equal(asub.cycle, 'year'); assert.equal(asub.with_page, true); assert.equal(asub.amount, 2650);
    const abegin = sumitCalls.filter(c => c.path === '/billing/payments/beginredirect/').pop()!.body;
    assert.equal(abegin.Items[0].UnitPrice, 2650);
    assert.equal(abegin.Items[0].Duration_Months, undefined, 'annual is not a standing order');
    assert.equal(abegin.MaximumPayments, 12, 'installments are chosen on SUMIT\'s page');
    assert.equal(abegin.ExternalIdentifier, asub.id);

    payments['800'] = { valid: true, amount: 250, ext: asub.id };   // the monthly price does not buy a year
    r = res(); await subscriptionReturn({ query: { ref: asub.id, 'OG-PaymentID': '800' } } as any, r);
    assert.equal(asub.status, 'pending');
    payments['801'] = { valid: true, amount: 2650, ext: asub.id };
    r = res(); await subscriptionReturn({ query: { ref: asub.id, 'OG-PaymentID': '801' } } as any, r);
    assert.equal(r.redirected, 'https://app.test/dashboard?seo_subscription=ok');
    assert.equal(asub.status, 'active');
    const months = (new Date(asub.current_period_end).getTime() - Date.now()) / (30.44 * 86400000);
    assert.ok(months > 11.9 && months < 12.1, `about 12 months, got ${months}`);
    r = res(); await getStatus(req({ authEmail: A }), r);
    assert.equal(r.body.subscription.planId, 'annual_page'); assert.equal(r.body.subscription.withPage, true);
    assert.equal(r.body.subscription.cycle, 'year'); assert.equal(r.body.subscription.renews, false);
    assert.equal(r.body.catalog.plans.length, 4);

    // cancel: only switches off renewal; nothing to stop at SUMIT, the paid year stays
    const cancelsBefore = sumitCalls.filter(c => c.path === '/billing/recurring/cancel/').length;
    r = res(); await cancel(req({ authEmail: A }), r);
    assert.equal(r.code, 200); assert.equal(r.body.cancelAtPeriodEnd, true); assert.equal(r.body.status, 'active');
    assert.equal(sumitCalls.filter(c => c.path === '/billing/recurring/cancel/').length, cancelsBefore, 'no SUMIT cancel call for a single payment');
    assert.equal(asub.needs_manual_cancel, false);
    assert.equal((await getEntitlements(A)).seo_autopilot, true, 'no refund, access to the end of the year');

    // reminder: once per period, only inside the window, only for annual plans, retried after a failed send
    const sent: any[] = [];
    let sendOk = true;
    const stub = async (p: any) => { sent.push(p); return sendOk; };
    asub.cancel_at_period_end = false;
    await sweepSubscriptions(new Date(), stub);
    assert.equal(sent.length, 0, 'a year away -> no reminder yet');
    asub.current_period_end = new Date(Date.now() + 10 * 86400000).toISOString();
    sendOk = false;
    await sweepSubscriptions(new Date(), stub);
    assert.equal(sent.length, 1); assert.equal(asub.reminder_for_period_end ?? null, null, 'failed send -> not marked, tried again next sweep');
    sendOk = true;
    await sweepSubscriptions(new Date(), stub);
    assert.equal(sent.length, 2); assert.equal(sent[1].to, A); assert.equal(sent[1].withPage, true);
    assert.equal(asub.reminder_for_period_end, asub.current_period_end);
    await sweepSubscriptions(new Date(), stub);
    assert.equal(sent.length, 2, 'once per period');
    const monthlyRow = db.seo_subscriptions.find(x => x.email === EMAIL)!;
    monthlyRow.status = 'active'; monthlyRow.cancel_at_period_end = false; monthlyRow.plan_id = 'monthly'; monthlyRow.cycle = 'month';
    monthlyRow.current_period_end = new Date(Date.now() + 3 * 86400000).toISOString();
    await sweepSubscriptions(new Date(), stub);
    assert.equal(sent.length, 2, 'a monthly standing order is never sent the annual reminder');

    // the year ends: no failed charge, no past_due and no grace; access is over
    asub.current_period_end = new Date(Date.now() - 86400000).toISOString();
    assert.equal(await sweepSubscriptions(new Date(), stub), 1);
    assert.equal(asub.status, 'canceled');
    assert.equal((await getEntitlements(A)).seo_autopilot, false);

    // buying again after it ended starts a fresh paid year
    r = res(); await start(req({ authEmail: A, body: { plan: 'annual' } }), r);
    assert.equal(r.code, 200); assert.equal(asub.status, 'pending'); assert.equal(asub.plan_id, 'annual'); assert.equal(asub.with_page, false); assert.equal(asub.amount, 2500);
    payments['802'] = { valid: true, amount: 2500, ext: asub.id };
    r = res(); await subscriptionReturn({ query: { ref: asub.id, 'OG-PaymentID': '802' } } as any, r);
    assert.equal(asub.status, 'active');
  }

  // 10. migration not run yet: every endpoint degrades, nothing throws
  missingTable = true;
  r = res(); await getStatus(req(), r);
  assert.equal(r.code, 200); assert.equal(r.body.subscription, null);
  r = res(); await start(req({ authEmail: 'm@x.co' }), r);
  assert.equal(r.code, 503); assert.equal(r.body.code, 'subscription_not_migrated');
  assert.equal(await sweepSubscriptions(), 0);
  await assert.rejects(() => getSubscription(EMAIL), (e: unknown) => e instanceof SubError && e.code === 'not_migrated');

  console.log('seo subscription checks passed');
})().catch(e => { console.error(e); process.exit(1); });
