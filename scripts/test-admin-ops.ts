// Run: npx ts-node --transpile-only scripts/test-admin-ops.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import {
  churn30, feedbackSignals, funnel, isStuck, isoWeekStart, median, mrr, overview, parsePremium, premiumOnly, premiumStale, revenue, stateOf, users,
  type JourneyR, type PremiumR, type ProductR, type SubR, type EventR,
} from '../src/services/adminOps';
import { placesSkuOf, placesUsageView, jobsView, recordHttp, httpView, resetHttp } from '../src/services/opsMetrics.service';

const now = new Date('2026-11-03T12:00:00Z');
const ago = (h: number) => new Date(now.getTime() - h * 3600000).toISOString();
const J = (email: string, o: Partial<JourneyR> = {}): JourneyR => ({
  email, stage: 'registered', source: null, utm_source: null, registered_at: ago(1), setup_at: null, ready_at: null,
  activation_requested_at: null, beta_activated_at: null, updated_at: ago(1), ...o,
});
const P = (email: string, source: string, endH: number | null, status = 'active'): ProductR => ({ email, status, source, current_period_end: endH === null ? null : ago(-endH) });

// helpers
assert.equal(median([]), null); assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5);
assert.equal(isoWeekStart(new Date('2026-11-03T12:00:00Z')), '2026-11-01', 'week starts on Sunday');

// states + stuck
const stuckJ = J('stuck@x.co', { registered_at: ago(60), updated_at: ago(60) });
assert.equal(isStuck(stuckJ, 'registered', now), true, 'registered, 60h without progress');
assert.equal(isStuck(J('new@x.co'), 'registered', now), false);
assert.equal(isStuck(J('s@x.co', { stage: 'setup', registered_at: ago(100), setup_at: ago(30), updated_at: ago(30) }), 'setup', now), false, 'progress 30h ago is not stuck');
assert.equal(isStuck(J('r@x.co', { stage: 'ready_to_activate', registered_at: ago(300), updated_at: ago(300) }), 'ready_to_activate', now), true, 'finished setup but never activated for 300h IS stuck-eligible');
assert.equal(isStuck(J('r2@x.co', { stage: 'ready_to_activate', registered_at: ago(300), updated_at: ago(300), activation_requested_at: ago(5) }), 'ready_to_activate', now), false, 'a fresh activation request is progress');
assert.equal(isStuck(J('r3@x.co', { stage: 'ready_to_activate', registered_at: ago(300), updated_at: ago(300) }), 'active_beta', now), false, 'an active customer is never stuck');
assert.equal(stateOf(J('a@x.co'), 'beta'), 'active_beta'); assert.equal(stateOf(J('a@x.co'), 'paid'), 'active');

const journeys: JourneyR[] = [
  J('a@x.co', { stage: 'ready_to_activate', utm_source: 'fb', registered_at: ago(24 * 10), setup_at: ago(24 * 10 - 2), ready_at: ago(24 * 9), beta_activated_at: ago(24 * 8), updated_at: ago(24 * 8) }),
  J('b@x.co', { stage: 'ready_to_activate', utm_source: 'fb', registered_at: ago(24 * 3), setup_at: ago(24 * 3 - 4), ready_at: ago(24 * 2), updated_at: ago(24 * 2) }),
  J('c@x.co', { stage: 'setup', source: 'audit', registered_at: ago(24 * 2), setup_at: ago(24 * 2 - 1), updated_at: ago(24 * 1.5) }),
  stuckJ,
  J('p@x.co', { stage: 'ready_to_activate', registered_at: ago(24 * 40), setup_at: ago(24 * 40 - 1), ready_at: ago(24 * 39), beta_activated_at: ago(24 * 38) }),
];
const products: ProductR[] = [P('a@x.co', 'manual', 24 * 80), P('p@x.co', 'sumit', 24 * 20), P('gone@x.co', 'manual', -24)];
const subs: SubR[] = [
  { email: 'p@x.co', status: 'active', amount: '199', created_at: ago(24 * 30), cancel_at_period_end: false, needs_manual_cancel: false },
  { email: 'q@x.co', status: 'past_due', amount: 199, created_at: ago(24 * 30), cancel_at_period_end: false, needs_manual_cancel: false },
  { email: 'z@x.co', status: 'canceled', amount: 199, created_at: ago(24 * 30), cancel_at_period_end: true, needs_manual_cancel: false },
  { email: 'n@x.co', status: 'pending', amount: 199, created_at: ago(24), cancel_at_period_end: false, needs_manual_cancel: false },
];
const premium: PremiumR[] = [
  { email: 'a@x.co', status: 'active', last_card_update: '2026-10-30', monthly_price: '500', note: null },
  { email: 'b@x.co', status: 'paused', last_card_update: null, monthly_price: 400, note: 'חופשה' },
  { email: 'c@x.co', status: 'active', last_card_update: null, monthly_price: null, note: null },
  { email: 'ghost@x.co', status: 'active', last_card_update: null, monthly_price: 300, note: null },
];

// MRR: SUMIT active + past_due (2 x 199) + manual only for ACTIVE rows with a price (500, ghost 300)
const m = mrr(subs, premium);
assert.deepEqual([m.sumit, m.manual, m.total], [398, 800, 1198]);
assert.equal(m.goalPct, 48, '1198 / 2500'); assert.equal(m.payingCount, 2); assert.equal(m.manualPayingCount, 2);
assert.equal(mrr([], [{ ...premium[0], monthly_price: null }]).total, 0, 'no price = no MRR, no default');

// MRR: manual premium stops counting once the account's access expired (or was cancelled)
const expiredAccess: ProductR[] = [P('a@x.co', 'manual', -24), P('ghost@x.co', 'manual', 24 * 5)];
const m2 = mrr(subs, premium, expiredAccess, now);
assert.deepEqual([m2.manual, m2.manualPayingCount], [300, 1], 'a@x.co (access ended yesterday) is out, ghost@x.co (access valid) stays');
assert.equal(mrr(subs, premium, [P('a@x.co', 'manual', 24 * 5, 'canceled')], now).manual, 300, 'a cancelled access row is out too');
assert.equal(mrr(subs, premium, [], now).manual, 800, 'no access row at all: still counted (tracked before access is granted)');

// overview
const o = overview({ journeys, products, subs, premium, alerts: [], now });
assert.deepEqual([o.signupsWeek, o.signupsPrev], [3, 1], 'last 7 days vs the 7 before');
assert.deepEqual([o.setupsCompleted, o.setupsWeek], [3, 1]);
assert.deepEqual([o.activeBeta, o.activePaid, o.stuck, o.manualPremiumActive], [1, 1, 1, 3]);
assert.equal(o.mrr.total, 1198);
// "what to do today" block
assert.deepEqual(o.todo, { stuck: 1, pendingActivation: 0, auditLeadsUnhandled: null, premiumStale: 2 }, 'premium: a fresh, c and ghost never recorded; b is paused');
assert.deepEqual(overview({ journeys, products, subs, premium, alerts: [], now, auditLeadsUnhandled: 4 }).todo.auditLeadsUnhandled, 4);
const stale = premiumStale([{ email: 'x@x.co', status: 'active', last_card_update: '2026-10-03', monthly_price: 1, note: null }, { email: 'y@x.co', status: 'active', last_card_update: '2026-10-05', monthly_price: 1, note: null }, { email: 'z@x.co', status: 'ended', last_card_update: '2020-01-01', monthly_price: 1, note: null }], now);
assert.equal(stale, 1, 'a card updated 31 days ago is stale, 29 days ago is not, an ended row is ignored');
const req = overview({ journeys: [J('q@x.co', { stage: 'ready_to_activate', activation_requested_at: ago(2) }), J('r@x.co', { stage: 'ready_to_activate', activation_requested_at: ago(30), beta_activated_at: ago(29) })], products: [P('r@x.co', 'manual', 24 * 60)], subs: [], premium: [], alerts: [{ level: 'bad', text: 'x' }], now });
assert.equal(req.todo.pendingActivation, 1, 'an activation request that was already granted is not pending');
assert.equal(req.alerts.length, 2); assert.deepEqual(req.alerts[0], { level: 'warn', text: 'בקשת הפעלה אחת ממתינה להפעלה ידנית.', tab: 'users' });

// funnel
const events: EventR[] = [
  ...['aaaaaaaa1', 'aaaaaaaa2', 'aaaaaaaa3', 'aaaaaaaa3', 'aaaaaaaa4'].map((anon_id) => ({ event: 'audit_completed', email: null, anon_id, props: {}, created_at: ago(5) })),
  { event: 'recs_viewed', email: null, anon_id: 'aaaaaaaa1', props: { top: 'reviews' }, created_at: ago(5) },
  { event: 'recs_viewed', email: null, anon_id: 'aaaaaaaa2', props: { top: 'reviews' }, created_at: ago(5) },
  { event: 'recs_viewed', email: null, anon_id: 'aaaaaaaa3', props: { top: 'photos' }, created_at: ago(5) },
  { event: 'recs_viewed', email: null, anon_id: 'old', props: { top: 'phone' }, created_at: ago(24 * 40) },
  { event: 'concierge_clicked', email: null, anon_id: 'aaaaaaaa1', props: { mode: 'audit' }, created_at: ago(5) },
];
const f = funnel(journeys, events, products, now);
assert.deepEqual(f.stages.map((x) => x.n), [4, 5, 4, 3, 2], 'audits (distinct visitors), registered, setup, ready, activated');
assert.deepEqual(f.stages.map((x) => x.conv), [null, null, 80, 75, 67], 'registered > audits: no misleading >100% conversion');
assert.deepEqual(f.medianHours, { registeredToSetup: 1.5, setupToReady: 22, readyToActivated: 24 });
assert.deepEqual(f.bySource.find((x) => x.source === 'fb'), { source: 'fb', registered: 2, setup: 2, ready: 2, activated: 1 });
assert.equal(f.bySource[0].registered, 2); assert.ok(f.bySource.some((x) => x.source === 'ישיר'));
assert.equal(f.cohorts.length, 4); assert.equal(f.cohorts[0].week, '2026-11-01'); assert.equal(f.cohorts[0].registered, 2); assert.equal(f.cohorts[1].registered, 1);
assert.equal(funnel([], [], [], now).stages[2].conv, null, 'empty data does not divide by zero');

// users
const us = users(journeys, products, premium, now);
assert.equal(us[0].email, 'c@x.co', 'newest first');
const byEmail = (e: string) => us.find((x) => x.email === e)!;
assert.equal(byEmail('stuck@x.co').stuck, true); assert.equal(byEmail('c@x.co').stuck, false);
assert.deepEqual([byEmail('a@x.co').state, byEmail('p@x.co').state], ['active_beta', 'active']);
assert.deepEqual(byEmail('a@x.co').premium, { status: 'active', lastCardUpdate: '2026-10-30', monthlyPrice: 500, note: null, expectedBy: null });
assert.equal(users(journeys, products, [{ ...premium[0], expected_by: '2026-11-12' }], now).find((u) => u.email === 'a@x.co')!.premium!.expectedBy, '2026-11-12');
assert.equal(byEmail('stuck@x.co').premium, null);
assert.deepEqual(premiumOnly(journeys, premium).map((x) => x.email), ['ghost@x.co']);

const pp = users([J('pp@x.co', { profile_state: 'pending_verification', pending_name: 'קפה נעמי' }), J('np@x.co')], [], [], now);
assert.deepEqual(pp.map((x) => [x.profilePending, x.pendingName]).sort(), [[false, null], [true, 'קפה נעמי']]);

// users: place name, phone (only via a public-Audit lead of the same place), activation request date
const ctxUsers = users([
  J('n1@x.co', { place_id: 'PLACE_AAAAAAA', activation_requested_at: ago(3) }), J('n2@x.co', { place_id: 'PLACE_BBBBBBB', profile_state: 'pending_verification', pending_name: 'שם שהוקלד' }), J('n3@x.co', { place_id: 'PLACE_CCCCCCC' }), J('n4@x.co'),
], [], [], now, {
  businesses: [{ owner_email: 'n3@x.co', name: 'העסק השמור' }],
  contacts: [
    { place_id: 'PLACE_AAAAAAA', name: 'ישן', phone: '0500000000', business_name: 'פיצה ישנה', created_at: ago(100) },
    { place_id: 'PLACE_AAAAAAA', name: 'חדש', phone: '0501234567', business_name: 'פיצה', created_at: ago(10) },
    { place_id: 'PLACE_CCCCCCC', name: 'x', phone: '0509999999', business_name: 'שם אחר', created_at: ago(10) },
  ],
});
const cu = (e: string) => ctxUsers.find((x) => x.email === e)!;
assert.deepEqual([cu('n1@x.co').placeName, cu('n1@x.co').phone, cu('n1@x.co').activationRequestedAt], ['פיצה', '0501234567', ago(3)], 'newest lead per place wins');
assert.equal(cu('n2@x.co').placeName, 'שם שהוקלד'); assert.equal(cu('n2@x.co').phone, null);
assert.equal(cu('n3@x.co').placeName, 'העסק השמור', 'the saved business beats the lead name'); assert.equal(cu('n3@x.co').phone, '0509999999');
assert.deepEqual([cu('n4@x.co').placeName, cu('n4@x.co').phone, cu('n4@x.co').activationRequestedAt], [null, null, null]);
assert.equal(users([J('s@x.co')], [], [], now)[0].phone, null, 'ctx is optional');
assert.equal(users([J('rr@x.co', { stage: 'ready_to_activate', registered_at: ago(300), updated_at: ago(300) })], [], [], now)[0].stuck, true);

// revenue
const rv = revenue({ journeys, products, subs, premium, now });
assert.deepEqual([rv.payingCustomers, rv.betaStarted, rv.betaToPaid, rv.betaToPaidPct, rv.readyToPay, rv.subsNeedingAttention], [2, 2, 1, 50, 1, 1]);
assert.deepEqual(rv.plans, [{ amount: 199, n: 2 }]);
assert.deepEqual(churn30([{ kind: 'canceled', created_at: ago(24 * 5) }, { kind: 'canceled', created_at: ago(24 * 50) }], 2, now), { canceled: 1, pct: 33 });
assert.equal(churn30([], 0, now).pct, null);

// manual premium input: validation, no default price
let r = parsePremium({ email: ' A@X.co ', status: 'active', lastCardUpdate: '2026-11-01', monthlyPrice: '500', note: ' ok ' }, now);
assert.ok(r.ok && r.value.email === 'a@x.co' && r.value.monthlyPrice === 500 && r.value.note === 'ok');
r = parsePremium({ email: 'a@x.co', status: 'active' }, now);
assert.ok(r.ok && r.value.monthlyPrice === null && r.value.lastCardUpdate === null, 'price stays empty unless written');
r = parsePremium({ email: 'a@x.co', status: 'active', expectedBy: '2026-11-12' }, now);
assert.ok(r.ok && r.value.expectedBy === '2026-11-12', 'expected date is kept');
r = parsePremium({ email: 'a@x.co', status: 'active', expectedBy: '' }, now);
assert.ok(r.ok && r.value.expectedBy === null, 'empty expected date clears it');
for (const bad of [{ email: 'a@x.co', status: 'active', expectedBy: '2026-02-31' }, { email: 'a@x.co', status: 'active', expectedBy: 'soon' }, { email: 'a@x.co', status: 'active', expectedBy: '2030-01-01' }]) assert.equal(parsePremium(bad, now).ok, false, JSON.stringify(bad));
for (const bad of [{ email: 'nope', status: 'active' }, { email: 'a@x.co', status: 'vip' }, { email: 'a@x.co', status: 'active', lastCardUpdate: '2026-02-31' },
  { email: 'a@x.co', status: 'active', lastCardUpdate: '2027-01-01' }, { email: 'a@x.co', status: 'active', monthlyPrice: -1 }, { email: 'a@x.co', status: 'active', monthlyPrice: 'abc' }, null]) {
  assert.equal(parsePremium(bad, now).ok, false, JSON.stringify(bad));
}

// feedback signals (30 days)
const fs = feedbackSignals(events, now);
assert.equal(fs.conciergeClicks30, 1); assert.deepEqual(fs.topRecommendations, [{ key: 'reviews', n: 2 }, { key: 'photos', n: 1 }]);

// Places usage
assert.equal(placesSkuOf('https://places.googleapis.com/v1/places:autocomplete'), 'autocomplete');
assert.equal(placesSkuOf('https://places.googleapis.com/v1/places:searchNearby'), 'nearby');
assert.equal(placesSkuOf('https://places.googleapis.com/v1/places/ChIJabcdefghij?languageCode=he'), 'details');
assert.equal(placesSkuOf('https://example.com/x'), null);
const pu = placesUsageView([{ sku: 'autocomplete', calls: 8000 }, { sku: 'details', calls: '799' }, { sku: 'nearby', calls: 1000 }]);
assert.deepEqual(pu.map((x) => [x.sku, x.pct, x.alert]), [['autocomplete', 80, true], ['details', 80, false], ['nearby', 100, true]], '80% of the free cap raises the alert (799/1000 does not)');
assert.equal(placesUsageView([]).every((x) => x.calls === 0 && !x.alert), true);

// job heartbeats
const hb = (job: string, o: object) => ({ job, last_run_at: ago(1), last_ok_at: null, last_error: null, last_error_at: null, runs: 3, ...o });
let jv = jobsView([hb('digest', { last_ok_at: ago(2) }), hb('review_alerts', { last_ok_at: ago(30) }), hb('subscriptions', { last_ok_at: ago(10), last_error: 'boom', last_error_at: ago(1) })], { setup_reminder: false }, now);
assert.deepEqual(jv.map((x) => x.status), ['ok', 'late', 'failing']); assert.equal(jv[2].lastError, 'boom');
jv = jobsView([], { digest: false, review_alerts: false, setup_reminder: false }, now);
assert.deepEqual(jv.map((x) => [x.job, x.status]), [['subscriptions', 'never']], 'jobs that are switched off are not reported');
assert.ok(jobsView([], {}, now).some((x) => x.job === 'setup_reminder' && x.status === 'never'), 'the reminder sweep is listed when switched on');
jv = jobsView([hb('digest', { last_ok_at: ago(1), last_error: 'old', last_error_at: ago(20) })], {}, now);
assert.equal(jv[0].status, 'ok'); assert.equal(jv[0].lastError, null, 'an old error followed by a success is not shown');

// 5xx counters
resetHttp();
const nowMs = now.getTime();
for (let i = 0; i < 18; i++) recordHttp(200, nowMs); recordHttp(500, nowMs); recordHttp(503, nowMs); recordHttp(404, nowMs - 30 * 3600000);
assert.deepEqual(httpView(24, nowMs), { hours: 24, total: 20, s5xx: 2, ratePct: 10 }, 'older than 24h is left out');

// Owner alerts: problems that need a human go out, "late"/informational ones stay on the dashboard
(async () => {
  const { checkHealthAlerts } = await import('../src/services/adminHealth.service');
  const sent: string[] = [];
  const snap = { alerts: [
    { level: 'warn', text: 'Places (details): 800 מתוך 1000 החודש (80%).' },
    { level: 'bad', text: 'ה-webhook של SUMIT נכשל לאחרונה.' },
    { level: 'warn', text: 'סיכום חודשי במייל: לא רץ בזמן.' },
  ] } as never;
  const n = await checkHealthAlerts(now, snap, async (t: string) => { sent.push(t); return true; });
  assert.equal(n, 2); assert.ok(sent[0].includes('Places') && sent[1].includes('SUMIT'));
  console.log('admin ops checks passed');
})();
