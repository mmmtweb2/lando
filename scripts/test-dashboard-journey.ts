// Run: npx tsx scripts/test-dashboard-journey.ts   (imports the client ES module, so ts-node/CJS cannot load it)
import assert from 'node:assert/strict';
import { deriveJourney, deriveNextStep, inquiriesText, journeyProgress, statusLine, type OverviewInput } from '../client/src/dashboard/journey';

const base: OverviewInput = { loaded: true, businessName: null, hasBusiness: false, contentCount: 0, monthLeads: 0, subscriptionStatus: null };
const biz: OverviewInput = { ...base, hasBusiness: true, businessName: 'שרברב דני' };
const full: OverviewInput = { ...biz, contentCount: 3, monthLeads: 9, subscriptionStatus: 'active' };

// plural forms
assert.equal(inquiriesText(1), 'פנייה אחת');
assert.equal(inquiriesText(2), '2 פניות');

// 1. new account: connect is the customer's turn, everything else waits, next step = connect
let j = deriveJourney(base);
assert.equal(j.length, 6);
assert.equal(j[0].state, 'yours');
assert.ok(j.slice(1).every((s) => s.state === 'waiting'));
assert.equal(journeyProgress(j).done, 0);
assert.equal(deriveNextStep(base).view, 'profile');
assert.match(deriveNextStep(base).title, /חברו/);
assert.match(statusLine(base), /עוד לא חיברתם/);

// 2. connected, nothing else yet: connect done, check/plan/reviews/content are the customer's turn, leads tracked by us
j = deriveJourney(biz);
assert.equal(j[0].state, 'done');
assert.equal(j[1].state, 'yours');
assert.equal(j[1].chip, 'בדוק עכשיו');
assert.equal(j[4].state, 'yours');
assert.equal(j[5].state, 'ours');
assert.equal(j[5].chip, 'אנחנו עוקבים');
assert.equal(journeyProgress(j).done, 1);
assert.match(deriveNextStep(biz).cta, /בדוק עכשיו/);
assert.match(statusLine(biz), /שרברב דני מחובר/);

// 3. content but no inquiries yet: next step = reviews link
const mid = { ...biz, contentCount: 2 };
assert.equal(deriveJourney(mid)[4].state, 'done');
assert.equal(deriveNextStep(mid).view, 'reviews');

// 4. inquiries are coming in
j = deriveJourney(full);
assert.equal(j[5].state, 'done');
assert.match(j[5].detail, /9 פניות/);
assert.equal(journeyProgress(j).done, 3);
assert.equal(deriveNextStep(full).view, 'leads');

// 5. a failed payment always wins and is marked urgent
const late = { ...full, subscriptionStatus: 'past_due' as const };
assert.equal(deriveNextStep(late).urgent, true);
assert.equal(deriveNextStep(late).view, 'plan');
assert.equal(deriveNextStep({ ...base, subscriptionStatus: 'past_due' }).urgent, true);

// 6. honesty: the profile score is never claimed, and no step promises something that is not live
const all = [base, biz, mid, full].flatMap((i) => [...deriveJourney(i).map((s) => s.detail + s.title), statusLine(i), deriveNextStep(i).body]).join(' ');
assert.ok(!/\d+ מתוך 100/.test(all), 'no invented score');
assert.ok(!/אחריות|30 יום|אוטומטי/.test(all), 'no guarantees or not-yet-live automation');

console.log('dashboard journey checks passed');
