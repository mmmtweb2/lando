// Run: npx tsx scripts/test-dashboard-journey.ts   (imports the client ES module, so ts-node/CJS cannot load it)
import assert from 'node:assert/strict';
import {
  deriveOngoingNext, derivePhase, deriveSetup, deriveSetupNext, inquiriesText, readiness, MANUAL_KEYS, PHASE2_ACK,
  type OverviewInput,
} from '../client/src/dashboard/journey';

const base: OverviewInput = { loaded: true, businessName: null, hasBusiness: false, contentCount: 0, monthLeads: 0, subscriptionStatus: null, ticks: [] };
const biz: OverviewInput = { ...base, hasBusiness: true, businessName: 'שרברב דני' };
const allTicks = [...MANUAL_KEYS];
const finished: OverviewInput = { ...biz, contentCount: 2, ticks: allTicks };
const SETUP_TICKS = ['first_check', 'profile_details', 'profile_verified', 'review_link_shared'];

assert.equal(inquiriesText(1), 'פנייה אחת');
assert.equal(inquiriesText(2), '2 פניות');

// 1. new account: 5 steps (spec v4), none done, phase = setup, next = connect
let items = deriveSetup(base);
assert.equal(items.length, 5);
assert.equal(items.filter((s) => s.done).length, 0);
assert.equal(derivePhase(base), 'setup');
assert.equal(deriveSetupNext(base)?.title, 'חיבור העסק');
assert.deepEqual(items.map((x) => x.id), ['connect', 'first_check', 'profile_details', 'profile_verified', 'review_link_shared']);
let r = readiness(items);
assert.deepEqual([r.done, r.total, r.percent, r.tier, r.label], [0, 5, 0, 'start', 'בתחילת הדרך']);

// 2. connecting a business is detected from data, not ticked
items = deriveSetup(biz);
assert.equal(items.find((s) => s.id === 'connect')!.done, true);
assert.equal(items.find((s) => s.id === 'connect')!.manual, false);
assert.equal(deriveSetupNext(biz)?.title, 'בדיקה ראשונה מול מתחרים');

// 3. a tick marks only that step; content and tracking are no longer setup steps
items = deriveSetup({ ...biz, contentCount: 1, ticks: ['profile_details'] });
assert.equal(items.find((s) => s.id === 'profile_details')!.done, true);
assert.equal(items.find((s) => s.id === 'first_check')!.done, false);
assert.equal(readiness(items).done, 2);
assert.equal(deriveSetup(biz).some((s) => (s.id as string) === 'content' || (s.id as string) === 'tracking_ready'), false);

// 4. tiers
const withTicks = (n: number) => readiness(deriveSetup({ ...biz, ticks: SETUP_TICKS.slice(0, n) }));
assert.equal(withTicks(0).tier, 'start');      // 1/5 = 20%
assert.equal(withTicks(1).tier, 'way');        // 2/5 = 40%
assert.equal(withTicks(3).tier, 'almost');     // 4/5 = 80%
assert.equal(withTicks(4).tier, 'ready');

// 5. the old content / tracking data does not hold setup back
assert.equal(derivePhase({ ...biz, ticks: SETUP_TICKS }), 'welcome');

// 6. phase only changes when everything is done AND the customer acknowledged
assert.equal(derivePhase(finished), 'welcome');
assert.equal(derivePhase({ ...finished, ticks: [...allTicks, PHASE2_ACK] }), 'ongoing');
assert.equal(deriveSetupNext(finished), null);

// 7. the acknowledgement alone does not skip stage 1
assert.equal(derivePhase({ ...biz, ticks: [PHASE2_ACK] }), 'setup');

// 8. a veteran who later loses the business goes back to setup, and ticks remain
const lost = { ...finished, hasBusiness: false, ticks: [...allTicks, PHASE2_ACK] };
assert.equal(derivePhase(lost), 'setup');
assert.equal(deriveSetup(lost).find((s) => s.id === 'first_check')!.done, true);

// 9. failed payment always comes first, in both stages
const pd = { ...biz, subscriptionStatus: 'past_due' as const };
assert.equal(deriveSetupNext(pd)?.urgent, true);
assert.equal(deriveSetupNext(pd)?.view, 'plan');
assert.equal(deriveOngoingNext({ ...finished, subscriptionStatus: 'past_due' }).urgent, true);

// 10. ongoing recommendation
assert.equal(deriveOngoingNext(finished).view, 'reviews');
const withLeads = deriveOngoingNext({ ...finished, monthLeads: 3 });
assert.equal(withLeads.view, 'profile');
assert.match(withLeads.body, /3 פניות/);

// 11. every setup item points at a real view and has plain-language text
for (const s of deriveSetup(base)) {
  assert.ok(s.title && s.how && s.cta, `item ${s.id} lacks text`);
  assert.ok(['profile', 'reviews'].includes(s.view));
}

console.log('dashboard journey checks passed');
