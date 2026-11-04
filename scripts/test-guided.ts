// Run: npx tsx scripts/test-guided.ts   (imports client ES modules)
import assert from 'node:assert/strict';
import {
  GUIDED_COPY, GUIDED_IDS, GUIDED_TOTAL, PREMIUM_DETAILS, SUCCESS_MS, inOurHandsText, shortDate, cardTexts, deriveGuided, minutesText, parseSkips, successLine, withSkip,
  type GuidedId,
} from '../client/src/dashboard/guided';
import type { OverviewInput } from '../client/src/dashboard/journey';

const base: OverviewInput = { loaded: true, businessName: null, hasBusiness: false, contentCount: 0, monthLeads: 0, subscriptionStatus: null, ticks: [] };
const biz: OverviewInput = { ...base, hasBusiness: true, businessName: 'שרברב דני', placeId: 'ChIJabcdefghij' };
const ids = (v: ReturnType<typeof deriveGuided>) => v.steps.filter((s) => !s.done).map((s) => s.id);

// 1. five steps in the agreed order, new account starts at step 1 of 5
assert.deepEqual(GUIDED_IDS, ['connect', 'first_check', 'profile_details', 'profile_verified', 'review_link_shared']);
assert.equal(GUIDED_TOTAL, 5);
let v = deriveGuided(base, []);
assert.equal(v.current?.id, 'connect');
assert.equal(v.position, 1);
assert.equal(v.doneCount, 0);
assert.equal(v.revisiting, false);
assert.equal(v.complete, false);
assert.deepEqual(v.upcoming.map((s) => s.id), ['first_check', 'profile_details', 'profile_verified', 'review_link_shared']);

// 2. connecting is detected from data; the next step is the automatic check
v = deriveGuided(biz, []);
assert.equal(v.current?.id, 'first_check');
assert.equal(v.position, 2);
assert.equal(v.doneCount, 1);
assert.equal(v.current?.auto, true);

// 3. resume: same input gives the same step (state lives in data + ticks, not in memory)
const resumed = deriveGuided({ ...biz, ticks: ['first_check', 'profile_details'] }, []);
assert.equal(resumed.current?.id, 'profile_verified');
assert.equal(resumed.position, 4);
assert.equal(resumed.doneCount, 3);
assert.equal(deriveGuided({ ...biz, ticks: ['first_check', 'profile_details'] }, []).current?.id, resumed.current?.id);

// 4. skipping never blocks: the next step comes first, the skipped one comes back at the end
const t1 = { ...biz, ticks: ['first_check'] };
v = deriveGuided(t1, ['profile_details']);
assert.equal(v.current?.id, 'profile_verified');
assert.equal(v.position, 4);
assert.equal(v.revisiting, false);
assert.deepEqual(v.upcoming.map((s) => s.id), ['review_link_shared', 'profile_details']);
const t2 = { ...t1, ticks: ['first_check', 'profile_verified', 'review_link_shared'] };
v = deriveGuided(t2, ['profile_details']);
assert.equal(v.current?.id, 'profile_details');
assert.equal(v.revisiting, true);
assert.equal(v.onlyThisLeft, true);
assert.equal(v.position, 3);

// 4b. connect and the automatic check cannot be postponed (a stale browser value is ignored)
assert.equal(GUIDED_COPY.connect.skippable, false);
assert.equal(GUIDED_COPY.first_check.skippable, false);
assert.equal(deriveGuided(base, ['connect']).current?.id, 'connect');
assert.equal(deriveGuided(base, ['connect']).revisiting, false);

// 5. skipping again sends a step to the back; several skips come back oldest first
let sk: GuidedId[] = [];
sk = withSkip(sk, 'profile_details', true);
sk = withSkip(sk, 'profile_verified', true);
assert.deepEqual(sk, ['profile_details', 'profile_verified']);
const only = { ...biz, ticks: ['first_check', 'review_link_shared'] };
v = deriveGuided(only, sk);
assert.equal(v.current?.id, 'profile_details');
assert.equal(v.revisiting, true);
sk = withSkip(sk, 'profile_details', true);                  // skipped again
assert.deepEqual(sk, ['profile_verified', 'profile_details']);
assert.equal(deriveGuided(only, sk).current?.id, 'profile_verified');
assert.deepEqual(withSkip(sk, 'profile_verified', false), ['profile_details']);

// 6. a skipped step that gets done by other means drops out; stale skips cannot hide the end
v = deriveGuided({ ...biz, ticks: [...GUIDED_IDS.slice(1)] }, ['profile_details', 'connect']);
assert.equal(v.complete, true);
assert.equal(v.current, null);
assert.equal(v.doneCount, 5);
assert.deepEqual(ids(v), []);

// 7. losing the business again reopens step 1, ticks stay
v = deriveGuided({ ...base, ticks: ['first_check', 'profile_details'] }, []);
assert.equal(v.current?.id, 'connect');
assert.equal(v.doneCount, 2);

// 8. the skip list from the browser is cleaned: unknown ids, duplicates, junk
assert.deepEqual(parseSkips('["profile_details","x","profile_details","connect"]'), ['profile_details', 'connect']);
assert.deepEqual(parseSkips('not json'), []);
assert.deepEqual(parseSkips({}), []);
assert.deepEqual(parseSkips(null), []);

// 9. every step has the five facts, no promises of results
for (const id of GUIDED_IDS) {
  const c = GUIDED_COPY[id];
  assert.ok(c.title && c.what && c.why && c.cta, `${id} lacks text`);
  assert.ok(c.minutes >= 1 && c.minutes <= 15);
  assert.ok(c.who === 'we' || c.who === 'you');
  for (const bad of ['מובטח', 'מבטיח', 'תעלו', 'ראשון בגוגל', 'דירוג', 'מקום ראשון', 'מבטיחים']) {
    assert.ok(!`${c.what} ${c.why}`.includes(bad), `${id} contains a promise: ${bad}`);
  }
}
assert.equal(GUIDED_COPY.connect.auto, true);
assert.equal(GUIDED_COPY.first_check.auto, true);
assert.equal(GUIDED_COPY.profile_details.auto, false);
assert.equal(minutesText(1), 'דקה אחת');
assert.equal(minutesText(5), '5 דקות');

// 10. success screen: under 2 seconds, with before / after, score only when we have one
assert.ok(SUCCESS_MS > 0 && SUCCESS_MS <= 2000);
assert.match(successLine('connect', { name: 'שרברב דני' }).after, /שרברב דני/);
assert.match(successLine('first_check', { score: 62 }).after, /62/);
assert.doesNotMatch(successLine('first_check', { score: null }).after, /\d/);
for (const id of GUIDED_IDS) { const l = successLine(id); assert.ok(l.title && l.before && l.after && l.before !== l.after); }

// 11. copy-ready texts: three blocks, built with placeholders so nothing invented is published
const texts = cardTexts('שרברב דני');
assert.deepEqual(texts.map((t) => t.id), ['about', 'hours', 'photos']);
assert.match(texts[0].text, /שרברב דני/);
assert.match(texts[0].text, /\[/);
assert.match(cardTexts(null)[0].text, /\[שם העסק\]/);

// 12. manual premium: the card step is ours, the customer only approves; the order is unchanged
const prem = { ...biz, ticks: ['first_check'], premium: { expectedBy: '2026-11-12' } };
v = deriveGuided(prem, []);
assert.equal(v.current?.id, 'profile_details');
assert.equal(v.current?.who, 'we');
assert.equal(v.current?.cta, 'אישור');
assert.match(v.current?.what ?? '', /אנחנו משלימים/);
assert.ok(v.current?.confirm);
assert.equal(v.position, 3);
assert.equal(deriveGuided({ ...biz, ticks: ['first_check'] }, []).current?.who, 'you', 'a regular customer is unchanged');
assert.equal(deriveGuided({ ...prem, ticks: [] }, []).upcoming.find((s) => s.id === 'profile_details')?.who, 'we');
assert.equal(deriveGuided({ ...prem, ticks: ['first_check', 'profile_details'] }, []).current?.id, 'profile_verified', 'approving moves on');
assert.equal(PREMIUM_DETAILS.id, 'profile_details');
assert.equal(PREMIUM_DETAILS.auto, false);
assert.equal(shortDate('2026-11-12'), '12.11');
assert.equal(shortDate('2026-01-05'), '5.1');
assert.equal(shortDate('soon'), null);
assert.equal(shortDate(null), null);
assert.equal(inOurHandsText('2026-11-12'), 'בטיפול אצלנו, צפוי עד 12.11');
assert.match(inOurHandsText(null), /^בטיפול אצלנו/);
assert.doesNotMatch(inOurHandsText(null), /\d/);
for (const bad of ['מובטח', 'מבטיח', 'ראשון בגוגל', 'תעלו', 'דירוג']) assert.ok(!`${PREMIUM_DETAILS.what} ${PREMIUM_DETAILS.why} ${PREMIUM_DETAILS.confirm}`.includes(bad), bad);

console.log('guided setup checks passed');
