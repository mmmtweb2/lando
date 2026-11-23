// Run: npx tsx scripts/test-seo-coupons.ts
// Discount coupons on the Google-promotion subscription (README part 148, migration 056).
// In-memory Supabase and a fake SUMIT: this proves OUR side (pricing, counting, the standing-order amount,
// renewal checks, refund amount, test price, pre-056 behaviour), not SUMIT's real answers.
import './_env-seo-subscription';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import {
  MIN_CHARGE, SEO_COUPON_INVALID, checkCoupon, priceWithCoupon, seoCouponPricing, type CouponRow,
} from '../src/services/coupon.service';
import {
  applyVerifiedPayment, couponPurposeFor, getSubscription, pricingView, refundOfferFor, startSubscription,
} from '../src/services/seoSubscription.service';
import { getStatus, start } from '../src/controllers/seoSubscription.controller';
import { validateCoupon } from '../src/controllers/payment.controller';
import { createCoupon, updateCoupon } from '../src/controllers/coupon.controller';
import { SEO_PLANS } from '../src/config/seoCatalog';

type Row = Record<string, any>;
const TABLES = ['seo_subscriptions', 'seo_subscription_events', 'seo_refund_requests', 'user_products', 'journey_events', 'payments', 'seo_addon_pages', 'landing_pages', 'coupons', 'coupon_redemptions'];
const db: Record<string, Row[]> = Object.fromEntries(TABLES.map(t => [t, []]));
const UNIQUE: Record<string, string[]> = { seo_subscriptions: ['email'], seo_refund_requests: ['email'], seo_subscription_events: ['sumit_payment_id'], coupons: ['code'] };
let seq = 0;
/** Simulates a database where migration 056 has not run: writing a coupon column fails like PostgREST does. */
let pre056 = false;
const COUPON_COLS = ['seo_duration'];
const SUB_COLS = ['coupon_id', 'recurring_amount', 'discount_amount'];
const missingCol = (table: string, patch: Row) =>
  pre056 && Object.keys(patch).some(k => (table === 'coupons' && COUPON_COLS.includes(k)) || (table === 'seo_subscriptions' && SUB_COLS.includes(k)));

(supabase as any).from = (table: string) => {
  db[table] ??= [];
  const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {}; let onConflict: string[] = []; let head = false;
  const rows = () => db[table].filter(r => f.every(fn => fn(r)));
  const run = (): any => {
    if ((op === 'insert' || op === 'update') && missingCol(table, patch)) {
      return { data: null, error: { code: 'PGRST204', message: `Could not find the '${Object.keys(patch).find(k => COUPON_COLS.includes(k) || SUB_COLS.includes(k))}' column of '${table}' in the schema cache` } };
    }
    if (op === 'insert') {
      for (const col of UNIQUE[table] ?? []) {
        if (patch[col] != null && db[table].some(r => r[col] === patch[col])) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      const defaults = table === 'coupons' && !pre056 && patch.seo_duration === undefined ? { seo_duration: 'first', redemptions_count: 0 } : table === 'coupons' ? { redemptions_count: 0 } : {};
      const row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, created_at: new Date(Date.now() + seq).toISOString(), ...defaults, ...patch };
      db[table].push(row); return { data: [row], error: null };
    }
    if (op === 'upsert') {
      const ex = db[table].find(r => onConflict.every(c => r[c] === patch[c]));
      if (ex) Object.assign(ex, patch); else db[table].push({ ...patch });
      return { data: null, error: null };
    }
    if (op === 'delete') { db[table] = db[table].filter(r => !f.every(fn => fn(r))); return { data: null, error: null }; }
    if (op === 'update') { const hit = rows(); hit.forEach(r => Object.assign(r, patch)); return { data: hit, error: null }; }
    const data = rows();
    return head ? { data: null, count: data.length, error: null } : { data, count: data.length, error: null };
  };
  const q: any = {
    select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) head = true; return q; },
    limit: () => q, order: () => q,
    insert: (p: Row) => { op = 'insert'; patch = p; return q; },
    update: (p: Row) => { op = 'update'; patch = p; return q; },
    delete: () => { op = 'delete'; return q; },
    upsert: (p: Row, o: { onConflict: string }) => { op = 'upsert'; patch = p; onConflict = o.onConflict.split(','); return q; },
    eq: (k: string, v: unknown) => { f.push(r => r[k] === v); return q; },
    neq: (k: string, v: unknown) => { f.push(r => r[k] !== v); return q; },
    in: (k: string, vs: unknown[]) => { f.push(r => vs.includes(r[k])); return q; },
    maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    single: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad),
  };
  return q;
};

// ── fake SUMIT ──
const sumitCalls: Array<{ path: string; body: any }> = [];
const payments: Record<string, { valid: boolean; amount: number; cust?: number }> = {};
let beginFails = false;
(globalThis as any).fetch = async (url: string, init: any) => {
  const path = new URL(url).pathname;
  const body = JSON.parse(init.body);
  sumitCalls.push({ path, body });
  const json = (o: unknown) => ({ json: async () => o });
  if (path === '/billing/payments/beginredirect/') {
    return beginFails ? json({ Status: 1, UserErrorMessage: 'תקלה' }) : json({ Status: 0, Data: { RedirectURL: 'https://pay.sumit/x' } });
  }
  if (path === '/billing/payments/get/') {
    const p = payments[String(body.PaymentID)];
    return p ? json({ Status: 0, Data: { Payment: { ValidPayment: p.valid, Amount: p.amount, Status: p.valid ? '000' : '1', ...(p.cust !== undefined ? { CustomerID: p.cust } : {}) } } }) : json({ Status: 1, UserErrorMessage: 'not found' });
  }
  if (path === '/billing/recurring/charge/') return json({ Status: 0, Data: { RecurringCustomerItemIDs: [4242] } });
  if (path === '/billing/recurring/cancel/') return json({ Status: 0 });
  throw new Error('unexpected SUMIT call ' + path);
};

function res() {
  const r: any = { code: 200, body: undefined };
  r.status = (c: number) => { r.code = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; };
  r.redirect = (u: string) => { r.redirected = u; return r; };
  return r;
}
const lastBegin = () => sumitCalls.filter(c => c.path === '/billing/payments/beginredirect/').pop()!.body;
const standingOrders = () => sumitCalls.filter(c => c.path === '/billing/recurring/charge/');

function coupon(code: string, extra: Partial<CouponRow> = {}): CouponRow {
  const row = {
    id: `c0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, created_at: new Date().toISOString(), code,
    discount_type: 'percent', discount_value: 30, applicable_purposes: ['seo_monthly', 'seo_annual'],
    max_redemptions: null, redemptions_count: 0, max_per_user: 1, active: true, expires_at: null, created_by: null, notes: null,
    seo_duration: 'first', ...extra,
  } as CouponRow;
  db.coupons.push(row as Row);
  return row;
}
const subOf = (email: string) => db.seo_subscriptions.find(r => r.email === email)!;
const couponById = (id: string) => db.coupons.find(c => c.id === id)!;
const DAY = 86400000;

(async () => {
  process.env.SEO_SUBSCRIPTION_ENABLED = 'true';
  process.env.SUMIT_STANDING_ORDER = 'after_payment';
  const warn0 = console.warn; console.warn = () => undefined;
  const err0 = console.error; console.error = () => undefined;   // the ALERT logs of refused payments are expected

  // ── 1. Pure pricing: percent and fixed, monthly and annual, the MIN_CHARGE floor, first vs forever ──
  const M = SEO_PLANS.monthly.price, Y = SEO_PLANS.annual.price;
  assert.deepEqual([M, Y], [250, 2500]);
  const pct30 = { discount_type: 'percent', discount_value: 30, seo_duration: 'first' } as CouponRow;
  assert.deepEqual(seoCouponPricing(pct30, M), { firstAmount: 175, discountAmount: 75, recurringAmount: 250, duration: 'first' });
  assert.deepEqual(seoCouponPricing({ ...pct30, seo_duration: 'forever' }, M), { firstAmount: 175, discountAmount: 75, recurringAmount: 175, duration: 'forever' });
  assert.deepEqual(seoCouponPricing(pct30, Y), { firstAmount: 1750, discountAmount: 750, recurringAmount: 2500, duration: 'first' });
  const fixed50 = { discount_type: 'fixed', discount_value: 50, seo_duration: 'forever' } as CouponRow;
  assert.deepEqual(seoCouponPricing(fixed50, M), { firstAmount: 200, discountAmount: 50, recurringAmount: 200, duration: 'forever' });
  assert.deepEqual(seoCouponPricing(fixed50, Y), { firstAmount: 2450, discountAmount: 50, recurringAmount: 2450, duration: 'forever' });
  assert.equal(priceWithCoupon({ discount_type: 'fixed', discount_value: 300 } as CouponRow, M).finalAmount, MIN_CHARGE, 'never below MIN_CHARGE');
  assert.deepEqual(seoCouponPricing({ discount_type: 'percent', discount_value: 100, seo_duration: 'forever' } as CouponRow, M),
    { firstAmount: 1, discountAmount: 249, recurringAmount: 1, duration: 'forever' }, '100% lands on 1 ₪, also for the standing order');
  assert.deepEqual(seoCouponPricing({ discount_type: 'percent', discount_value: 12.5 } as CouponRow, M).firstAmount, 218.75, 'agorot kept');
  assert.equal(seoCouponPricing({ discount_type: 'percent', discount_value: 30 } as CouponRow, M).duration, 'first', "no seo_duration -> 'first'");
  assert.equal(couponPurposeFor(SEO_PLANS.monthly), 'seo_monthly'); assert.equal(couponPurposeFor(SEO_PLANS.annual), 'seo_annual');

  // ── 2. Purpose checks ──
  const both = coupon('FIRST30');
  const monthlyOnly = coupon('MONTHONLY', { applicable_purposes: ['seo_monthly'] });
  const anyPurpose = coupon('ANYTHING', { applicable_purposes: null });
  const pagesOnly = coupon('PAGES10', { applicable_purposes: ['publish'] });
  assert.equal((await checkCoupon('first30', 'seo_monthly', 'a@x.co')).ok, true, 'case-insensitive, monthly');
  assert.equal((await checkCoupon('FIRST30', 'seo_annual', 'a@x.co')).ok, true, 'annual');
  assert.deepEqual(await checkCoupon('MONTHONLY', 'seo_annual', 'a@x.co'), { ok: false, error: SEO_COUPON_INVALID }, 'monthly-only code is not valid on the annual plan');
  assert.deepEqual(await checkCoupon('ANYTHING', 'seo_monthly', 'a@x.co'), { ok: false, error: SEO_COUPON_INVALID }, '"any purpose" never reaches the subscription');
  assert.equal((await checkCoupon('ANYTHING', 'publish', 'a@x.co')).ok, true, '...but still works on landing pages as before');
  assert.deepEqual(await checkCoupon('PAGES10', 'seo_monthly', 'a@x.co'), { ok: false, error: SEO_COUPON_INVALID });
  assert.equal((await checkCoupon('FIRST30', 'publish', 'a@x.co')).ok, false, 'a subscription code does not discount a landing page');
  void monthlyOnly; void anyPurpose; void pagesOnly;

  // ── 3. Preview endpoint (validate-coupon) for the subscription ──
  let r = res(); await validateCoupon({ authEmail: 'a@x.co', body: { code: 'FIRST30', purpose: 'seo_monthly', reference: 'monthly' } } as any, r);
  assert.equal(r.code, 200);
  assert.deepEqual([r.body.baseAmount, r.body.finalAmount, r.body.discountAmount, r.body.recurringAmount, r.body.seoDuration], [250, 175, 75, 250, 'first']);
  assert.ok(!('notes' in r.body) && !('id' in r.body), 'nothing internal');
  r = res(); await validateCoupon({ authEmail: 'a@x.co', body: { code: 'FIRST30', purpose: 'seo_monthly', reference: 'annual' } } as any, r);
  assert.equal(r.code, 400, 'monthly purpose priced against the annual plan is refused');
  r = res(); await validateCoupon({ authEmail: 'a@x.co', body: { code: 'FIRST30', purpose: 'seo_annual', reference: 'annual' } } as any, r);
  assert.deepEqual([r.body.baseAmount, r.body.finalAmount], [2500, 1750]);
  assert.equal(couponById(both.id).redemptions_count, 0, 'the preview counts nothing');

  // ── 4. Monthly, 'first' (30%): checkout 175, standing order 250, renewals must be 250 ──
  const A = 'first@x.co';
  r = res(); await start({ authEmail: A, body: { plan: 'monthly', couponCode: 'first30' } } as any, r);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  let s = subOf(A);
  assert.deepEqual([s.status, Number(s.amount), s.coupon_id, Number(s.recurring_amount), Number(s.discount_amount)], ['pending', 175, both.id, 250, 75]);
  assert.equal(lastBegin().Items[0].UnitPrice, 175, 'SUMIT page charges the discounted first month');
  assert.equal(couponById(both.id).redemptions_count, 1, 'counted when the checkout opened (CAS)');
  assert.deepEqual(db.coupon_redemptions.map(x => [x.coupon_id, x.user_email, x.payment_id]), [[both.id, A, null]], 'audit row, no payments row');
  assert.equal(db.payments.length, 0, 'the subscription never writes a payments row');
  // Re-opening the same unpaid checkout with the same code (closed tab / pay from another device) counts nothing more
  r = res(); await start({ authEmail: A, body: { plan: 'monthly', couponCode: 'FIRST30' } } as any, r);
  assert.equal(r.code, 200);
  assert.equal(couponById(both.id).redemptions_count, 1); assert.equal(db.coupon_redemptions.length, 1);
  assert.equal(lastBegin().Items[0].UnitPrice, 175);
  // First payment verified: amount moves to the renewal price, standing order created at 250
  payments['f1'] = { valid: true, amount: 175, cust: 501 };
  const t0 = new Date();
  assert.equal(await applyVerifiedPayment(s.id, { sumitPaymentId: 'f1', valid: true, amount: 175 }, { sumitCustomerId: '501' }, t0), 'activated');
  s = subOf(A);
  assert.deepEqual([s.status, Number(s.amount), s.sumit_recurring_item_id], ['active', 250, '4242']);
  assert.equal(standingOrders().pop()!.body.Items[0].UnitPrice, 250, "'first': the standing order charges the list price");
  // Refund within 14 days = what was actually charged
  let offer = await refundOfferFor(await getSubscription(A) as any, t0);
  assert.deepEqual([offer.eligible, offer.amount], [true, 175], 'refund = the 175 ₪ actually charged, not 250');
  // Customer card
  r = res(); await getStatus({ authEmail: A } as any, r);
  assert.deepEqual(r.body.subscription.pricing, { list: 250, first: 175, next: 250, couponDuration: 'first' });
  assert.equal(r.body.subscription.refund.amount, 175);
  // Renewal at the discounted amount is refused, at the list price accepted
  const t1 = new Date(t0.getTime() + 31 * DAY);
  assert.equal(await applyVerifiedPayment(s.id, { sumitPaymentId: 'f2', valid: true, amount: 175 }, { sumitCustomerId: '501' }, t1), 'underpaid', "'first': a 175 renewal is not enough");
  assert.equal(await applyVerifiedPayment(s.id, { sumitPaymentId: 'f3', valid: true, amount: 250 }, { sumitCustomerId: '501' }, t1), 'activated');
  assert.equal(standingOrders().length, 1, 'one standing order per subscription');

  // ── 5. Monthly, 'forever' (30%): checkout 175, standing order 175, renewals of 175 accepted, less refused ──
  const forever = coupon('ALWAYS30', { seo_duration: 'forever', applicable_purposes: ['seo_monthly'] });
  const B = 'forever@x.co';
  r = res(); await start({ authEmail: B, body: { plan: 'monthly', couponCode: 'ALWAYS30' } } as any, r);
  assert.equal(r.code, 200);
  s = subOf(B);
  assert.deepEqual([Number(s.amount), Number(s.recurring_amount), Number(s.discount_amount)], [175, 175, 75]);
  assert.equal(await applyVerifiedPayment(s.id, { sumitPaymentId: 'g1', valid: true, amount: 175 }, { sumitCustomerId: '502' }, t0), 'activated');
  s = subOf(B);
  assert.equal(Number(s.amount), 175);
  assert.equal(standingOrders().pop()!.body.Items[0].UnitPrice, 175, "'forever': the standing order charges the discounted amount");
  assert.equal(await applyVerifiedPayment(s.id, { sumitPaymentId: 'g2', valid: true, amount: 174 }, { sumitCustomerId: '502' }, t1), 'underpaid', 'below the discounted amount is refused');
  assert.equal(await applyVerifiedPayment(s.id, { sumitPaymentId: 'g3', valid: true, amount: 175 }, { sumitCustomerId: '502' }, t1), 'activated', 'the discounted renewal is accepted');
  r = res(); await getStatus({ authEmail: B } as any, r);
  assert.deepEqual(r.body.subscription.pricing, { list: 250, first: 175, next: 175, couponDuration: 'forever' });
  void forever;

  // ── 6. Annual: one payment, no standing order; 'forever' changes nothing beyond it ──
  const yearly = coupon('YEAR30', { seo_duration: 'forever', applicable_purposes: ['seo_annual'] });
  const C = 'annual@x.co';
  r = res(); await start({ authEmail: C, body: { plan: 'annual', couponCode: 'YEAR30' } } as any, r);
  assert.equal(r.code, 200);
  assert.equal(lastBegin().Items[0].UnitPrice, 1750); assert.equal(lastBegin().MaximumPayments, 12);
  s = subOf(C);
  const soBefore = standingOrders().length;
  assert.equal(await applyVerifiedPayment(s.id, { sumitPaymentId: 'y1', valid: true, amount: 1750 }, { sumitCustomerId: '503' }, t0), 'activated');
  assert.equal(standingOrders().length, soBefore, 'annual: no standing order');
  assert.equal(Number(subOf(C).amount), 1750, 'annual: amount stays what was paid');
  r = res(); await getStatus({ authEmail: C } as any, r);
  assert.deepEqual(r.body.subscription.pricing, { list: 2500, first: 1750, next: null, couponDuration: 'forever' });
  offer = await refundOfferFor(await getSubscription(C) as any, t0);
  assert.equal(offer.amount, 1750, 'annual refund = charged amount');
  void yearly;

  // ── 7. Fixed amount + MIN_CHARGE through the real checkout ──
  coupon('HUGE', { discount_type: 'fixed', discount_value: 1000, applicable_purposes: ['seo_monthly'] });
  r = res(); await start({ authEmail: 'huge@x.co', body: { plan: 'monthly', couponCode: 'HUGE' } } as any, r);
  assert.equal(r.code, 200);
  assert.equal(lastBegin().Items[0].UnitPrice, MIN_CHARGE);
  assert.deepEqual([Number(subOf('huge@x.co').discount_amount), Number(subOf('huge@x.co').recurring_amount)], [249, 250]);

  // ── 8. Refusals: invalid / exhausted / per-user cap / unknown -> 400, nothing opened, nothing counted ──
  const begins = () => sumitCalls.filter(c => c.path === '/billing/payments/beginredirect/').length;
  let b0 = begins();
  r = res(); await start({ authEmail: 'z@x.co', body: { plan: 'annual', couponCode: 'MONTHONLY' } } as any, r);
  assert.deepEqual([r.code, r.body.code, r.body.error], [400, 'coupon', SEO_COUPON_INVALID]);
  r = res(); await start({ authEmail: 'z@x.co', body: { plan: 'monthly', couponCode: 'NOPE' } } as any, r);
  assert.equal(r.code, 400);
  const once = coupon('ONEUSE', { max_redemptions: 1, applicable_purposes: ['seo_monthly'] });
  r = res(); await start({ authEmail: 'one@x.co', body: { plan: 'monthly', couponCode: 'ONEUSE' } } as any, r);
  assert.equal(r.code, 200);
  r = res(); await start({ authEmail: 'two@x.co', body: { plan: 'monthly', couponCode: 'ONEUSE' } } as any, r);
  assert.equal(r.code, 400, 'exhausted');
  assert.equal(couponById(once.id).redemptions_count, 1);
  // A's own subscription is active now: per-user cap means a second checkout (e.g. after cancelling) is refused
  assert.equal(begins(), b0 + 1, 'only the one valid checkout opened');
  b0 = begins();

  // ── 9. SUMIT page fails to open: the use is given back and the row loses the coupon ──
  const flaky = coupon('FLAKY', { applicable_purposes: ['seo_monthly'] });
  beginFails = true;
  r = res(); await start({ authEmail: 'flaky@x.co', body: { plan: 'monthly', couponCode: 'FLAKY' } } as any, r);
  beginFails = false;
  assert.equal(r.code, 502);
  assert.equal(couponById(flaky.id).redemptions_count, 0, 'use released');
  assert.deepEqual([subOf('flaky@x.co').coupon_id, subOf('flaky@x.co').recurring_amount], [null, null]);
  assert.equal(db.coupon_redemptions.filter(x => x.coupon_id === flaky.id).length, 0, 'no audit row for a page that never opened');
  r = res(); await start({ authEmail: 'flaky@x.co', body: { plan: 'monthly', couponCode: 'FLAKY' } } as any, r);
  assert.equal(r.code, 200); assert.equal(couponById(flaky.id).redemptions_count, 1, 'the retry counts it (it was given back)');
  // A new checkout WITHOUT a code clears the stale discount
  r = res(); await start({ authEmail: 'flaky@x.co', body: { plan: 'monthly' } } as any, r);
  assert.equal(r.code, 200);
  assert.deepEqual([Number(subOf('flaky@x.co').amount), subOf('flaky@x.co').coupon_id, subOf('flaky@x.co').recurring_amount], [250, null, null]);
  assert.equal(lastBegin().Items[0].UnitPrice, 250);

  // ── 10. Test price wins: no coupon on a test price, nothing counted ──
  process.env.SEO_TEST_PRICE = '1'; process.env.SEO_TEST_EMAILS = 'tester@x.co';
  const countBefore = couponById(both.id).redemptions_count;
  r = res(); await start({ authEmail: 'tester@x.co', body: { plan: 'monthly', couponCode: 'FIRST30' } } as any, r);
  assert.equal(r.code, 200);
  assert.equal(lastBegin().Items[0].UnitPrice, 1, 'the test price, not 175');
  assert.equal(couponById(both.id).redemptions_count, countBefore, 'no use counted');
  assert.ok(!('coupon_id' in subOf('tester@x.co')), 'no coupon written');
  r = res(); await validateCoupon({ authEmail: 'tester@x.co', body: { code: 'FIRST30', purpose: 'seo_monthly', reference: 'monthly' } } as any, r);
  assert.equal(r.code, 400, 'the preview says the code does not apply');
  r = res(); await getStatus({ authEmail: 'tester@x.co' } as any, r);
  assert.equal(r.body.testMode, true, 'the page hides the code field for test accounts');
  delete process.env.SEO_TEST_PRICE; delete process.env.SEO_TEST_EMAILS;

  // ── 11. Pricing view without a coupon (and for a test row: recurring = amount) ──
  assert.deepEqual(pricingView({ amount: 250, plan_id: 'monthly', cycle: 'month' } as any), { list: 250, first: null, next: 250, couponDuration: null });
  assert.deepEqual(pricingView({ amount: 1, plan_id: 'monthly', cycle: 'month' } as any).next, 1);

  // ── 12. Admin: SEO purposes, seo_duration, validation ──
  const admin = (body: Row) => ({ authEmail: 'admin@x.co', body, params: {} }) as any;
  r = res(); await createCoupon(admin({ code: 'launch', discount_type: 'percent', discount_value: 20, applicable_purposes: ['seo_monthly', 'seo_annual'], seo_duration: 'forever' }), r);
  assert.equal(r.code, 201); assert.deepEqual([r.body.code, r.body.seo_duration, r.body.applicable_purposes], ['LAUNCH', 'forever', ['seo_monthly', 'seo_annual']]);
  r = res(); await createCoupon(admin({ code: 'LAUNCH2', discount_type: 'percent', discount_value: 20, applicable_purposes: ['seo_monthly'], seo_duration: 'always' }), r);
  assert.equal(r.code, 400, 'unknown duration');
  r = res(); await createCoupon(admin({ code: 'LAUNCH3', discount_type: 'percent', discount_value: 20, applicable_purposes: ['seo_weekly'] }), r);
  assert.equal(r.code, 400, 'unknown purpose');
  r = res(); await createCoupon(admin({ code: 'PAGESONLY', discount_type: 'fixed', discount_value: 20, applicable_purposes: ['publish'] }), r);
  assert.equal(r.code, 201);
  const created = db.coupons.find(c => c.code === 'LAUNCH')!;
  r = res(); await updateCoupon({ params: { id: created.id }, body: { seo_duration: 'first' } } as any, r);
  assert.equal(r.code, 200); assert.equal(created.seo_duration, 'first');

  // ── 13. Before migration 056: nothing crashes, subscription coupons are simply not valid ──
  pre056 = true;
  const legacy = { ...coupon('OLDSEO', { applicable_purposes: ['seo_monthly'] }) } as Row;
  delete legacy.seo_duration; db.coupons[db.coupons.length - 1] = legacy;   // a row with no seo_duration column
  assert.deepEqual(await checkCoupon('OLDSEO', 'seo_monthly', 'p@x.co'), { ok: false, error: SEO_COUPON_INVALID });
  r = res(); await start({ authEmail: 'p@x.co', body: { plan: 'monthly', couponCode: 'OLDSEO' } } as any, r);
  assert.deepEqual([r.code, r.body.error], [400, SEO_COUPON_INVALID]);
  r = res(); await start({ authEmail: 'p@x.co', body: { plan: 'monthly' } } as any, r);
  assert.equal(r.code, 200, 'a plain checkout still works (no coupon column is written)');
  assert.ok(!('coupon_id' in subOf('p@x.co')) && !('recurring_amount' in subOf('p@x.co')));
  assert.equal(await applyVerifiedPayment(subOf('p@x.co').id, { sumitPaymentId: 'p1', valid: true, amount: 250 }, { sumitCustomerId: '509' }, t0), 'activated');
  assert.equal(standingOrders().pop()!.body.Items[0].UnitPrice, 250, 'no recurring_amount -> the subscription amount');
  r = res(); await getStatus({ authEmail: 'p@x.co' } as any, r);
  assert.deepEqual(r.body.subscription.pricing, { list: 250, first: null, next: 250, couponDuration: null });
  r = res(); await createCoupon(admin({ code: 'NEWSEO', discount_type: 'percent', discount_value: 10, applicable_purposes: ['seo_monthly'] }), r);
  assert.equal(r.code, 400); assert.match(r.body.error, /056/, 'admin is told to run migration 056');
  r = res(); await createCoupon(admin({ code: 'NEWPAGE', discount_type: 'percent', discount_value: 10, applicable_purposes: ['publish'] }), r);
  assert.equal(r.code, 201, 'landing-page coupons are created as before');
  pre056 = false;

  console.warn = warn0; console.error = err0;
  console.log('seo coupons: all checks passed');
})().catch((e) => { process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`); process.exit(1); });
