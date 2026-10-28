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

assert.equal(inquiriesText(1), 'פנייה אחת');
assert.equal(inquiriesText(2), '2 פניות');

// 1. new account: 7 steps, none done, phase = setup, next = connect
let items = deriveSetup(base);
assert.equal(items.length, 7);
assert.equal(items.filter((s) => s.done).length, 0);
assert.equal(derivePhase(base), 'setup');
assert.equal(deriveSetupNext(base)?.title, 'חיבור העסק');
let r = readiness(items);
assert.deepEqual([r.done, r.total, r.percent, r.tier, r.label], [0, 7, 0, 'start', 'בתחילת הדרך']);

// 2. connecting a business is detected from data, not ticked
items = deriveSetup(biz);
assert.equal(items.find((s) => s.id === 'connect')!.done, true);
assert.equal(items.find((s) => s.id === 'connect')!.manual, false);
assert.equal(deriveSetupNext(biz)?.title, 'בדיקה ראשונה מול המובילים');

// 3. content is detected from data; a tick of a manual key marks only that step
items = deriveSetup({ ...biz, contentCount: 1, ticks: ['profile_details'] });
assert.equal(items.find((s) => s.id === 'content')!.done, true);
assert.equal(items.find((s) => s.id === 'profile_details')!.done, true);
assert.equal(items.find((s) => s.id === 'first_check')!.done, false);
assert.equal(readiness(items).done, 3);

// 4. tracking is done by a tick OR by a real inquiry this month
assert.equal(deriveSetup({ ...biz, monthLeads: 1 }).find((s) => s.id === 'tracking_ready')!.done, true);
assert.equal(deriveSetup({ ...biz, ticks: ['tracking_ready'] }).find((s) => s.id === 'tracking_ready')!.done, true);

// 5. tiers
const withTicks = (n: number, extra: Partial<OverviewInput> = {}) => readiness(deriveSetup({ ...biz, ...extra, ticks: MANUAL_KEYS.slice(0, n) }));
assert.equal(withTicks(0).tier, 'start');      // 1/7 = 14%
assert.equal(withTicks(2).tier, 'way');        // 3/7 = 43%
assert.equal(withTicks(4, { contentCount: 1 }).tier, 'almost'); // 6/7 = 86%... connect + 4 ticks + content
assert.equal(withTicks(5, { contentCount: 1 }).tier, 'ready');

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
  assert.ok(['profile', 'reviews', 'content', 'leads'].includes(s.view));
}

console.log('dashboard journey checks passed');
