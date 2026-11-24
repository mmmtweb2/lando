// Run: npx tsx scripts/test-qa-billing.ts
// QA 23–24.11 billing findings (README part 151): coupon reason codes, plan-switch re-check of a code, the
// ONE billing state and its wording on every screen, the ₪1 minimum messaging, the checkout timeout.
// In-memory Supabase and a fake SUMIT: this proves OUR side, not SUMIT's real timings.
import './_env-seo-subscription';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import {
  COUPON_REASONS, MIN_CHARGE, checkCoupon, couponReasonMessage, hitsMinCharge, type CouponRow,
} from '../src/services/coupon.service';
import { SubError, getSubscription, redirectTimeoutMs, withTimeout } from '../src/services/seoSubscription.service';
import { getStatus, start } from '../src/controllers/seoSubscription.controller';
import { validateCoupon } from '../src/controllers/payment.controller';
import { BILLING_STATES as SERVER_STATES, billingStateOf } from '../src/services/seoBillingState';
import { rateLimit } from '../src/middleware/rateLimit';
import paymentRoutes from '../src/routes/payment.routes';
import {
  BILLING_STATES, CHECKOUT_SLOW_MS, MIN_CHARGE_ADMIN_WARNING, billingCopy, checkoutPhaseText, includedPageCopy,
  minChargeAdminWarning, minChargeNote, type BillingAccess,
} from '../client/src/lib/billingState';
import { afterCheck, appliedFor, couponKey, needsRecheck } from '../client/src/lib/couponRecheck';

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
const UNIQUE: Record<string, string[]> = { seo_subscriptions: ['email'], seo_subscription_events: ['sumit_payment_id'], coupons: ['code'] };
let seq = 0;
let failRedemptionRead = false;
(supabase as any).from = (table: string) => {
  db[table] ??= [];
  const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {}; let onConflict: string[] = []; let head = false;
  const rows = () => db[table].filter(r => f.every(fn => fn(r)));
  const run = (): any => {
    if (table === 'coupon_redemptions' && op === 'select' && failRedemptionRead) return { data: null, error: { message: 'boom' } };
    if (op === 'insert') {
      for (const col of UNIQUE[table] ?? []) if (patch[col] != null && db[table].some(r => r[col] === patch[col])) return { data: null, error: { code: '23505', message: 'dup' } };
      const row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, created_at: new Date().toISOString(), ...patch };
      db[table].push(row); return { data: [row], error: null };
    }
    if (op === 'upsert') { const ex = db[table].find(r => onConflict.every(c => r[c] === patch[c])); if (ex) Object.assign(ex, patch); else db[table].push({ ...patch }); return { data: null, error: null }; }
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

let sumitDelayMs = 0;
let beginCalls = 0;
(globalThis as any).fetch = async (url: string) => {
  const path = new URL(url).pathname;
  const json = (o: unknown) => ({ json: async () => o });
  if (path === '/billing/payments/beginredirect/') {
    beginCalls++;
    if (sumitDelayMs) await new Promise(r => setTimeout(r, sumitDelayMs));
    return json({ Status: 0, Data: { RedirectURL: 'https://pay.sumit/x' } });
  }
  if (path === '/billing/recurring/cancel/') return json({ Status: 0 });
  throw new Error('unexpected SUMIT call ' + path);
};

function res() {
  const r: any = { code: 200, body: undefined, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.code = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return r;
}
function coupon(code: string, extra: Partial<CouponRow> = {}): CouponRow {
  const row = {
    id: `c0000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, created_at: new Date().toISOString(), code,
    discount_type: 'percent', discount_value: 30, applicable_purposes: ['seo_monthly', 'seo_annual'],
    max_redemptions: null, redemptions_count: 0, max_per_user: 1, active: true, expires_at: null, created_by: null, notes: null,
    seo_duration: 'first', ...extra,
  } as CouponRow;
  (db.coupons ??= []).push(row as Row);
  return row;
}
const DAY = 86400000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

(async () => {
  process.env.SEO_SUBSCRIPTION_ENABLED = 'true';
  const warn0 = console.warn; console.warn = () => undefined;
  const err0 = console.error; console.error = () => undefined;
  const log0 = console.log; console.log = () => undefined;

  // ── 1. Reason codes: every refusal says why, in one Hebrew sentence ──
  coupon('GOOD');
  coupon('MONTHONLY', { applicable_purposes: ['seo_monthly'] });
  coupon('YEARONLY', { applicable_purposes: ['seo_annual'] });
  coupon('PAGESONLY', { applicable_purposes: ['publish'] });
  coupon('ANY', { applicable_purposes: null });
  coupon('OLD', { expires_at: iso(-DAY) });
  coupon('OFF', { active: false });
  coupon('LATER', { starts_at: iso(3 * DAY) });
  coupon('STARTED', { starts_at: iso(-DAY) });
  coupon('FULL', { max_redemptions: 5, redemptions_count: 5 });
  const mine = coupon('MINE', { max_per_user: 1 });
  db.coupon_redemptions = [{ id: 'r1', coupon_id: mine.id, user_email: 'a@x.co', payment_id: null }];
  coupon('LEGACY', { seo_duration: undefined });

  const reason = async (code: string, purpose: string, email = 'a@x.co') => {
    const c = await checkCoupon(code, purpose, email);
    return c.ok ? 'ok' : c.reason;
  };
  assert.equal(await reason('good', 'seo_monthly'), 'ok');
  assert.equal(await reason('STARTED', 'seo_monthly'), 'ok', 'a start date in the past is fine');
  assert.equal(await reason('XYZ123', 'seo_monthly'), 'not_found');
  assert.equal(await reason('OLD', 'seo_monthly'), 'expired');
  assert.equal(await reason('OFF', 'seo_monthly'), 'expired', 'switched off by the admin reads as an ended promotion');
  assert.equal(await reason('LATER', 'seo_monthly'), 'not_started');
  assert.equal(await reason('FULL', 'seo_monthly'), 'exhausted');
  assert.equal(await reason('MINE', 'seo_monthly'), 'already_used_by_you');
  assert.equal(await reason('MINE', 'seo_monthly', 'b@x.co'), 'ok', 'another account may still use it');
  assert.equal(await reason('MONTHONLY', 'seo_annual'), 'wrong_plan');
  assert.equal(await reason('YEARONLY', 'seo_monthly'), 'wrong_plan');
  assert.equal(await reason('PAGESONLY', 'seo_monthly'), 'not_for_this_product');
  assert.equal(await reason('ANY', 'seo_annual'), 'not_for_this_product', '"any purpose" never reaches the subscription');
  assert.equal(await reason('GOOD', 'publish'), 'not_for_this_product', 'a subscription code on a landing-page purchase');
  assert.equal(await reason('PAGESONLY', 'credits'), 'wrong_plan', 'landing purposes: another purchase of the same product');
  assert.equal(await reason('LEGACY', 'seo_monthly'), 'unavailable', 'no seo_duration (before 056)');
  failRedemptionRead = true;
  assert.equal(await reason('MINE', 'seo_monthly'), 'check_failed', 'unreadable history fails closed');
  failRedemptionRead = false;

  const wrong = await checkCoupon('MONTHONLY', 'seo_annual', 'a@x.co');
  assert.ok(!wrong.ok);
  assert.deepEqual([wrong.fits, wrong.error], [['seo_monthly'], 'הקוד הזה חל רק על המסלול החודשי.']);
  const wrong2 = await checkCoupon('YEARONLY', 'seo_monthly', 'a@x.co');
  assert.ok(!wrong2.ok && wrong2.error === 'הקוד הזה חל רק על המסלול השנתי.');
  const later = await checkCoupon('LATER', 'seo_monthly', 'a@x.co');
  assert.ok(!later.ok && /החל מ-\d/.test(later.error), 'not_started names the date');
  const old = await checkCoupon('OLD', 'seo_monthly', 'a@x.co');
  assert.ok(!old.ok && /הסתיים ב-\d/.test(old.error), 'expired names the date');

  // Every reason has its own, non-empty Hebrew sentence (no bare "not valid").
  const sentences = COUPON_REASONS.map(r => couponReasonMessage(r, { purpose: 'seo_monthly', fits: ['seo_monthly'] }));
  for (const s of sentences) { assert.ok(/[א-ת]/.test(s) && s.length > 12, s); assert.ok(!/^הקוד לא תקף\.?$/.test(s)); }
  assert.equal(new Set(sentences).size, sentences.length, 'one distinct sentence per reason');
  assert.ok(!couponReasonMessage('not_found').includes('קיים'), 'not_found does not hint at other codes');

  // validate-coupon returns the reason (and what the code fits); start returns it too.
  let r = res();
  await validateCoupon({ authEmail: 'a@x.co', body: { code: 'MONTHONLY', purpose: 'seo_annual', reference: 'annual' } } as any, r);
  assert.deepEqual([r.code, r.body.valid, r.body.reason, r.body.fits], [400, false, 'wrong_plan', ['seo_monthly']]);
  r = res();
  await validateCoupon({ authEmail: 'a@x.co', body: { code: 'NOPE', purpose: 'seo_monthly', reference: 'monthly' } } as any, r);
  assert.deepEqual([r.code, r.body.reason], [400, 'not_found']);
  r = res();
  await start({ authEmail: 'z@x.co', body: { plan: 'annual', couponCode: 'MONTHONLY' } } as any, r);
  assert.deepEqual([r.code, r.body.code, r.body.reason, r.body.fits], [400, 'coupon', 'wrong_plan', ['seo_monthly']]);
  assert.equal(beginCalls, 0, 'a refused code opens no checkout');

  // ── 2. Brute force: validate-coupon sits behind per-IP (hour + burst) AND per-account limits ──
  const route = (paymentRoutes as any).stack.find((l: any) => l.route?.path === '/validate-coupon').route;
  assert.ok(route.stack.length >= 5, 'three limiters + auth + handler');
  const perAccount = rateLimit({ windowMs: 60_000, max: 2, key: (req: any) => `acct:${req.authEmail}` });
  const hit = (email: string, ip: string) => { const rr = res(); let passed = false; perAccount({ authEmail: email, ip } as any, rr, () => { passed = true; }); return passed ? 200 : rr.code; };
  assert.deepEqual([hit('a@x.co', '1.1.1.1'), hit('a@x.co', '2.2.2.2'), hit('a@x.co', '3.3.3.3'), hit('b@x.co', '3.3.3.3')], [200, 200, 429, 200],
    'one account cannot spread guesses over many IPs');

  // ── 3. Plan switch: the code is re-checked for the new plan ──
  const kM = couponKey('seo_monthly', ['monthly']);
  const kY = couponKey('seo_annual', ['annual']);
  let box = afterCheck(null, kM, 'MONTHONLY', { ok: true });
  assert.equal(appliedFor(box, kM), 'MONTHONLY');
  assert.equal(needsRecheck(box, kM), false, 'same plan: nothing to do');
  assert.equal(needsRecheck(box, kY), true, 'switched plan: check again');
  assert.equal(appliedFor(box, kY), null, 'never shown as applied to a plan it was not checked for');
  box = afterCheck(box, kY, 'MONTHONLY', { ok: false, error: 'הקוד הזה חל רק על המסלול החודשי.' });
  assert.deepEqual([box.status, box.wasApplied, box.error], ['refused', true, 'הקוד הזה חל רק על המסלול החודשי.'], 'refused and marked "not applied"');
  assert.equal(needsRecheck(box, kM), true, 'back to monthly: check again');
  box = afterCheck(box, kM, 'MONTHONLY', { ok: true });
  assert.equal(appliedFor(box, kM), 'MONTHONLY', 'applied again on the plan it fits');
  const both = afterCheck(afterCheck(null, kM, 'GOOD', { ok: true }), kY, 'GOOD', { ok: true });
  assert.equal(appliedFor(both, kY), 'GOOD', 'a code valid on both plans stays applied');
  assert.equal(needsRecheck(null, kY), false); assert.equal(needsRecheck({ code: '', key: kM, status: 'refused' }, kY), false);
  assert.equal(afterCheck(null, kM, 'X', { ok: false, error: 'e' }).wasApplied, false, 'a new code that fails was never applied');

  // ── 4. ONE billing state, derived on the server ──
  const now = new Date();
  const sub = (o: Partial<Row>) => ({ status: 'active', current_period_end: iso(10 * DAY), cancel_at_period_end: false, cycle: 'month', ...o }) as any;
  const grantRow = { status: 'active', current_period_end: iso(20 * DAY), source: 'manual' };
  assert.equal(billingStateOf(null, null, { now }).state, 'none');
  assert.deepEqual(billingStateOf(grantRow, null, { now }), { state: 'grant', until: grantRow.current_period_end, cycle: null });
  assert.equal(billingStateOf({ ...grantRow, current_period_end: null }, null, { now }).until, null, 'a grant without an end date');
  assert.equal(billingStateOf({ ...grantRow, current_period_end: iso(-DAY) }, null, { now }).state, 'none', 'an ended grant');
  assert.equal(billingStateOf({ ...grantRow, source: 'sumit' }, null, { now }).state, 'none', 'a sumit mirror without a subscription is not a grant');
  assert.equal(billingStateOf(null, sub({}), { now }).state, 'monthly');
  assert.equal(billingStateOf(null, sub({ cycle: 'year' }), { now }).state, 'annual');
  assert.equal(billingStateOf(null, sub({ cancel_at_period_end: true }), { now }).state, 'canceled_until');
  assert.equal(billingStateOf(null, sub({ status: 'past_due', current_period_end: iso(-DAY) }), { now }).state, 'past_due');
  assert.equal(billingStateOf(null, sub({ status: 'past_due', current_period_end: iso(-DAY) }), { now, renewalPending: true }).renewalPending, true);
  assert.equal(billingStateOf(null, sub({ status: 'canceled', current_period_end: iso(-DAY) }), { now }).state, 'none');
  assert.equal(billingStateOf(null, sub({ status: 'pending' }), { now }).state, 'none', 'an unpaid checkout is not a subscription');
  assert.equal(billingStateOf(grantRow, sub({}), { now }).state, 'monthly', 'what the customer pays for wins over a grant');
  assert.equal(billingStateOf(grantRow, sub({ status: 'canceled', current_period_end: iso(-DAY) }), { now }).state, 'grant');
  assert.deepEqual([...SERVER_STATES], [...BILLING_STATES], 'server and client agree on the states');

  // GET /api/seo/subscription carries it.
  db.user_products = [{ email: 'g@x.co', product: 'seo_autopilot', ...grantRow }];
  r = res(); await getStatus({ authEmail: 'g@x.co' } as any, r);
  assert.deepEqual([r.body.access.state, r.body.access.until, r.body.subscription], ['grant', grantRow.current_period_end, null]);
  r = res(); await getStatus({ authEmail: 'nobody@x.co' } as any, r);
  assert.equal(r.body.access.state, 'none');

  // ── 5. The wording helper covers every state, and the screens cannot contradict each other ──
  const accessOf = (state: BillingAccess['state'], extra: Partial<BillingAccess> = {}): BillingAccess =>
    ({ state, until: iso(10 * DAY), cycle: state === 'annual' ? 'year' : state === 'grant' || state === 'none' ? null : 'month', ...extra });
  const titles = new Set<string>();
  for (const state of BILLING_STATES) {
    const c = billingCopy(accessOf(state), { price: 250 });
    assert.equal(c.state, state);
    for (const t of [c.title, c.line, c.after]) assert.ok(t && /[א-ת]/.test(t), `${state}: wording present`);
    assert.ok(!/אין צורך במנוי|אין כרגע חיוב חודשי לנהל/.test(c.title + c.line + c.after), `${state}: none of the old contradicting lines`);
    titles.add(c.title);
    const inc = includedPageCopy(accessOf(state));
    for (const t of [inc.title, inc.line, inc.after, inc.success]) assert.ok(t && /[א-ת]/.test(t), `${state}: publish dialog wording`);
  }
  assert.equal(titles.size, BILLING_STATES.length, 'one title per state');
  const until = new Date(Date.now() + 10 * DAY).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' });
  const g = billingCopy(accessOf('grant'));
  assert.equal(g.title, `גישה ניסיונית עד ${until}`);
  assert.ok(g.after.includes(until) && g.after.includes('ייעצרו') && g.after.includes('לא נחייב'), 'grant: what happens after the date');
  assert.equal(g.action, 'plans', 'a grant has nothing to cancel');
  assert.equal(billingCopy(accessOf('grant', { until: null })).title, 'גישה ניסיונית');
  assert.equal(billingCopy(accessOf('monthly')).action, 'cancel', 'paying monthly: cancel button');
  assert.equal(billingCopy(accessOf('annual')).action, 'cancel', 'paying annual: cancel button');
  assert.ok(billingCopy(accessOf('monthly'), { price: 175 }).line.includes('₪175'));
  assert.ok(billingCopy(accessOf('monthly'), { renews: false }).line.startsWith('המנוי פעיל עד'), 'no standing order: no promised charge');
  assert.equal(billingCopy(accessOf('canceled_until')).action, 'renew');
  assert.equal(billingCopy(accessOf('past_due', { until: iso(-DAY) })).action, 'update_card');
  assert.equal(billingCopy(accessOf('past_due', { renewalPending: true })).action, null, 'renewal day: nothing to do');
  assert.equal(billingCopy(accessOf('none')).action, 'join');
  assert.ok(includedPageCopy(accessOf('grant')).title.includes('ניסיונית'), 'publish dialog: grant is not called a subscription');
  assert.ok(!includedPageCopy(accessOf('grant')).after.includes('המנוי פעיל'));
  assert.ok(includedPageCopy(null).title && !includedPageCopy(null).title.includes('מנוי'), 'while loading: neutral, true in every state');

  // ── 6. ₪1 minimum: kept, and said out loud ──
  assert.equal(MIN_CHARGE, 1);
  assert.equal(hitsMinCharge({ discount_type: 'percent', discount_value: 100 }, 250), true);
  assert.equal(hitsMinCharge({ discount_type: 'fixed', discount_value: 2500 }, 2500), true);
  assert.equal(hitsMinCharge({ discount_type: 'percent', discount_value: 30 }, 250), false);
  coupon('GROK2', { discount_value: 100, applicable_purposes: ['seo_monthly'] });
  r = res(); await validateCoupon({ authEmail: 'a@x.co', body: { code: 'GROK2', purpose: 'seo_monthly', reference: 'monthly' } } as any, r);
  assert.deepEqual([r.code, r.body.finalAmount, r.body.minCharge], [200, 1, true]);
  r = res(); await validateCoupon({ authEmail: 'a@x.co', body: { code: 'GOOD', purpose: 'seo_monthly', reference: 'monthly' } } as any, r);
  assert.equal(r.body.minCharge, false);
  const nM = minChargeNote({ finalAmount: 1, discountAmount: 249, minCharge: true }, 'month')!;
  assert.equal(nM.priceLabel, '₪1 בלבד לאימות אמצעי התשלום');
  assert.ok(nM.explain.includes('הוראת הקבע') && nM.button.includes('₪1'));
  assert.ok(minChargeNote({ finalAmount: 1, discountAmount: 2499 }, 'year')!.explain.includes('השנה'), 'annual explained too (inferred without the flag)');
  assert.equal(minChargeNote({ finalAmount: 175, discountAmount: 75, minCharge: false }, 'month'), null);
  assert.equal(minChargeAdminWarning('percent', 100, [250]), MIN_CHARGE_ADMIN_WARNING);
  assert.ok(MIN_CHARGE_ADMIN_WARNING.startsWith('המינימום לחיוב הוא ₪1 (נדרש כדי לשמור אמצעי תשלום להוראת הקבע)'));
  assert.equal(minChargeAdminWarning('fixed', 250, [250, 2500]), MIN_CHARGE_ADMIN_WARNING, 'any ticked plan at the floor');
  assert.equal(minChargeAdminWarning('percent', 50, [250, 2500]), null);
  assert.equal(minChargeAdminWarning('percent', 100, []), null, 'no subscription plan ticked: no warning');

  // ── 7. Opening the checkout: progressive text, and a bounded wait with a clear retry message ──
  assert.equal(checkoutPhaseText(0), 'מתחברים למערכת התשלומים המאובטחת…');
  assert.equal(checkoutPhaseText(CHECKOUT_SLOW_MS - 1), 'מתחברים למערכת התשלומים המאובטחת…');
  assert.equal(checkoutPhaseText(CHECKOUT_SLOW_MS), 'זה לוקח קצת יותר מהרגיל…');
  assert.equal(redirectTimeoutMs({}), 20000); assert.equal(redirectTimeoutMs({ SUMIT_REDIRECT_TIMEOUT_MS: '9000' }), 9000);
  assert.equal(redirectTimeoutMs({ SUMIT_REDIRECT_TIMEOUT_MS: '100' }), 20000, 'out of range ignored');
  await assert.rejects(withTimeout(new Promise(r => setTimeout(r, 200)), 20), (e: unknown) => e instanceof SubError && e.code === 'sumit_timeout');
  assert.equal(await withTimeout(Promise.resolve(7), 50), 7);

  // A slow SUMIT: the customer gets 504 + a retry sentence, the coupon use is given back, nothing else changes.
  process.env.SUMIT_REDIRECT_TIMEOUT_MS = '5000';
  sumitDelayMs = 5600;
  const slow = coupon('SLOW', { max_redemptions: 1 });
  r = res(); await start({ authEmail: 's@x.co', body: { plan: 'monthly', couponCode: 'SLOW' } } as any, r);
  assert.deepEqual([r.code, r.body.code], [504, 'sumit_timeout']);
  assert.ok(r.body.error.includes('לא בוצע שום חיוב') && r.body.error.includes('נסו שוב'));
  assert.equal((db.coupons.find(c => c.id === slow.id) as Row).redemptions_count, 0, 'the use is returned');
  const s1 = await getSubscription('s@x.co');
  assert.equal(s1?.status, 'pending'); assert.equal(s1?.coupon_id, null, 'the code is taken off the unopened checkout');
  sumitDelayMs = 0;
  r = res(); await start({ authEmail: 's@x.co', body: { plan: 'monthly', couponCode: 'SLOW' } } as any, r);
  assert.deepEqual([r.code, r.body.redirectUrl], [200, 'https://pay.sumit/x'], 'retry works, same code');
  delete process.env.SUMIT_REDIRECT_TIMEOUT_MS;

  console.warn = warn0; console.error = err0; console.log = log0;
  console.log('test-qa-billing: all assertions passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
