// Run: npx ts-node --transpile-only scripts/test-seo-subscription.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
process.env.SUMIT_COMPANY_ID = '123';
process.env.SUMIT_API_KEY = 'k';
process.env.PUBLIC_API_URL = 'https://api.test';
process.env.PUBLIC_APP_URL = 'https://app.test';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import { cancel, getStatus, start, subscriptionReturn, subscriptionWebhook } from '../src/controllers/seoSubscription.controller';
import { SubError, getSubscription, sweepSubscriptions } from '../src/services/seoSubscription.service';
import { getEntitlements } from '../src/services/entitlements.service';

type Row = Record<string, any>;
const db: Record<string, Row[]> = { seo_subscriptions: [], seo_subscription_events: [], user_products: [] };
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
    select: () => q,
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
const payments: Record<string, { valid: boolean; amount: number }> = {};
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
    return p ? json({ Status: 0, Data: { Payment: { ValidPayment: p.valid, Amount: p.amount, Status: p.valid ? '000' : '1' } } }) : json({ Status: 1, UserErrorMessage: 'not found' });
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
  r = res(); await start(req(), r);
  assert.equal(r.code, 503, 'enabled but no price -> still off');
  process.env.SEO_PLAN_PRICE = '99';

  // 2. start: a pending row, and a SUMIT request that says monthly + the exact price
  beginFails = true;
  r = res(); await start(req(), r);
  assert.equal(r.code, 502); assert.equal(r.body.error, 'כרטיס לא נתמך');
  beginFails = false;
  r = res(); await start(req(), r);
  assert.equal(r.code, 200); assert.equal(r.body.redirectUrl, 'https://pay.sumit/x');
  assert.equal(db.seo_subscriptions.length, 1, 'one row per account, reused on retry');
  const sub = db.seo_subscriptions[0];
  assert.equal(sub.status, 'pending'); assert.equal(sub.amount, 99);
  const begin = sumitCalls.filter(c => c.path === '/billing/payments/beginredirect/').pop()!.body;
  assert.equal(begin.Items[0].UnitPrice, 99); assert.equal(begin.Items[0].Duration_Months, 1);
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
  payments['501'] = { valid: true, amount: 99 };
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
  db.seo_subscriptions.push({ id: '00000000-0000-4000-8000-0000000000aa', email: 'v@x.co', status: 'pending', amount: 99, current_period_end: null, cancel_at_period_end: false });
  r = res(); await subscriptionReturn({ query: { ref: '00000000-0000-4000-8000-0000000000aa', 'OG-PaymentID': '501' } } as any, r);
  assert.equal(db.seo_subscriptions[1].status, 'pending', 'a consumed payment id cannot activate another account');
  db.seo_subscriptions.pop();

  // 5. status + already subscribed
  r = res(); await getStatus(req(), r);
  assert.equal(r.body.enabled, true); assert.equal(r.body.price, 99); assert.equal(r.body.subscription.status, 'active');
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
  payments['600'] = { valid: true, amount: 99 };
  r = res(); await subscriptionWebhook({ query: { secret: 'topsecret' }, body: { ExternalIdentifier: sub.id, 'Payment.ID': '600' } } as any, r);
  assert.equal(r.code, 200); assert.equal(r.body.applied, 'activated');
  const end2 = new Date(db.seo_subscriptions[0].current_period_end).getTime();
  assert.ok(end2 > end1 + 27 * 86400000, 'renewal added a month to the existing end');
  payments['601'] = { valid: false, amount: 0 };
  r = res(); await subscriptionWebhook({ query: { secret: 'topsecret' }, body: { ExternalIdentifier: sub.id, 'Payment.ID': '601' } } as any, r);
  assert.equal(r.body.applied, 'failed');
  assert.equal(db.seo_subscriptions[0].status, 'past_due');
  assert.equal((await getEntitlements(EMAIL)).seo_autopilot, true, 'a failed charge does not cut access on day one');
  payments['602'] = { valid: true, amount: 99 };
  r = res(); await subscriptionWebhook({ query: { secret: 'topsecret' }, body: { ExternalIdentifier: sub.id, 'Payment.ID': '602' } } as any, r);
  assert.equal(db.seo_subscriptions[0].status, 'active', 'a later good charge recovers');
  r = res(); await subscriptionWebhook({ query: { secret: 'topsecret' }, body: { ExternalIdentifier: 'garbage' } } as any, r);
  assert.equal(r.code, 200); assert.equal(r.body.applied, 'no_ref');

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
  payments['700'] = { valid: true, amount: 99 };
  r = res(); await subscriptionReturn({ query: { ref: row.id, 'OG-PaymentID': '700' } } as any, r);
  assert.equal(db.user_products[0].source, 'manual');
  assert.equal(db.user_products[0].current_period_end, null);

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
