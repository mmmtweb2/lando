// Run: npx tsx scripts/test-monthly.ts   (imports client ES modules)
import assert from 'node:assert/strict';
import {
  MONTHLY_COPY, MONTHLY_IDS, REQUESTS_GOAL, deriveMonthly, freshMonth, inMonth, markDone, markSkipped, monthKey, monthlySuccess,
  observe, parseMonth, remainingText, type MonthlyData,
} from '../client/src/dashboard/monthly';
import type { OverviewInput } from '../client/src/dashboard/journey';

const input: OverviewInput = { loaded: true, businessName: 'x', hasBusiness: true, contentCount: 2, monthLeads: 0, subscriptionStatus: null, ticks: [] };
const data = (o: Partial<MonthlyData> = {}, i: Partial<OverviewInput> = {}): MonthlyData => ({ input: { ...input, ...i }, requestsSent: 0, pendingReplies: null, ...o });
const KEY = '2026-11';
const st = freshMonth(KEY, 2);

// 1. month key and "sent this month"
assert.equal(monthKey(new Date(2026, 10, 4)), '2026-11');
assert.equal(monthKey(new Date(2026, 0, 31)), '2026-01');
assert.equal(inMonth(new Date(2026, 10, 2, 12).toISOString(), KEY), true);
assert.equal(inMonth(new Date(2026, 9, 31, 12).toISOString(), KEY), false);
assert.equal(inMonth(null, KEY), false);
assert.equal(inMonth('garbage', KEY), false);

// 2. start of the month: without Google replies there are three tasks, first one is the review requests
let v = deriveMonthly(data(), st);
assert.deepEqual(v.tasks.map((t) => t.id), ['review_requests', 'search_phrases', 'tracking']);
assert.equal(v.total, 3);
assert.equal(v.current?.id, 'review_requests');
assert.equal(v.doneCount, 0);
assert.equal(v.complete, false);
assert.deepEqual(v.upcoming.map((u) => u.id), ['search_phrases', 'tracking']);

// 3. detection from data
assert.equal(deriveMonthly(data({ requestsSent: REQUESTS_GOAL - 1 }), st).current?.id, 'review_requests');
v = deriveMonthly(data({ requestsSent: REQUESTS_GOAL }), st);
assert.equal(v.tasks.find((t) => t.id === 'review_requests')!.done, true);
assert.equal(v.current?.id, 'search_phrases');
assert.equal(deriveMonthly(data({}, { contentCount: 3 }), st).tasks.find((t) => t.id === 'search_phrases')!.done, true, 'new content since the month began');
assert.equal(deriveMonthly(data({}, { contentCount: 2 }), st).tasks.find((t) => t.id === 'search_phrases')!.done, false, 'old content does not count');
assert.equal(deriveMonthly(data({}, { monthLeads: 1 }), st).tasks.find((t) => t.id === 'tracking')!.done, true);

// 4. replies: shown only while some wait; stays (as done) after the last one is answered
assert.equal(deriveMonthly(data({ pendingReplies: 0 }), st).tasks.some((t) => t.id === 'review_replies'), false, 'nothing to answer: no task');
assert.equal(deriveMonthly(data({ pendingReplies: null }), st).tasks.some((t) => t.id === 'review_replies'), false, 'unknown: no task');
v = deriveMonthly(data({ pendingReplies: 2 }), st);
assert.deepEqual(v.tasks.map((t) => t.id), ['review_requests', 'review_replies', 'search_phrases', 'tracking']);
const seen = observe(st, data({ pendingReplies: 2 }));
assert.equal(seen.repliesSeen, true);
assert.equal(observe(st, data({ pendingReplies: 0 })), st, 'no change object when nothing new');
v = deriveMonthly(data({ pendingReplies: 0 }), seen);
assert.equal(v.tasks.find((t) => t.id === 'review_replies')!.done, true, 'answered: done, not vanished');
assert.equal(v.total, 4);

// 5. manual done, skip, and skipping again
let s = markDone(st, 'tracking');
assert.equal(deriveMonthly(data(), s).tasks.find((t) => t.id === 'tracking')!.done, true);
s = markSkipped(st, 'review_requests');
v = deriveMonthly(data(), s);
assert.equal(v.current?.id, 'search_phrases', 'a skipped task does not block');
assert.deepEqual(v.upcoming.map((u) => u.id), ['tracking', 'review_requests'], 'it comes back at the end');
s = markSkipped(markSkipped(st, 'review_requests'), 'search_phrases');
assert.equal(deriveMonthly(data(), s).current?.id, 'tracking');
const allDoneButSkipped = markDone(markDone(s, 'tracking'), 'review_requests');
v = deriveMonthly(data(), allDoneButSkipped);
assert.equal(v.current?.id, 'search_phrases');
assert.equal(v.revisiting, true, 'the only open task is one that was postponed');
v = deriveMonthly(data(), markSkipped(markDone(markDone(st, 'tracking'), 'review_requests'), 'search_phrases'));
assert.equal(v.revisiting, true);
assert.equal(v.onlyThisLeft, true);
assert.equal(markDone(markSkipped(st, 'tracking'), 'tracking').skipped.length, 0, 'done removes the skip');

// 6. everything done
v = deriveMonthly(data({ requestsSent: 3 }, { contentCount: 5, monthLeads: 2 }), st);
assert.equal(v.complete, true);
assert.equal(v.current, null);
assert.equal(remainingText(v), 'כל משימות החודש הושלמו.');
assert.equal(remainingText(deriveMonthly(data(), st)), 'נשארו 3 משימות החודש.');
assert.equal(remainingText(deriveMonthly(data({ requestsSent: 3 }, { monthLeads: 1 }), st)), 'נשארה משימה אחת החודש.');

// 7. a new month starts clean and takes today's content as the baseline; same month is kept
const kept = JSON.stringify({ month: KEY, done: ['tracking', 'x', 'tracking'], skipped: ['review_requests'], baseContent: 1, repliesSeen: true });
let p = parseMonth(kept, KEY, 9);
assert.deepEqual([p.done, p.skipped, p.baseContent, p.repliesSeen], [['tracking'], ['review_requests'], 1, true]);
p = parseMonth(kept, '2026-12', 9);
assert.deepEqual([p.month, p.done, p.skipped, p.baseContent, p.repliesSeen], ['2026-12', [], [], 9, false]);
for (const bad of ['not json', null, undefined, '[]', '5', {}]) {
  const q = parseMonth(bad, KEY, 4);
  assert.deepEqual([q.done, q.skipped, q.baseContent], [[], [], 4]);
}

// 8. copy: five facts per task, no promise of a result, honest success lines
for (const id of MONTHLY_IDS) {
  const c = MONTHLY_COPY[id];
  assert.ok(c.title && c.what && c.why && c.cta && c.minutes >= 1);
  for (const bad of ['מובטח', 'מבטיח', 'ראשון בגוגל', 'תעלו', 'דירוג', 'מבטיחים']) assert.ok(!`${c.what} ${c.why}`.includes(bad), `${id}: ${bad}`);
  const l = monthlySuccess(id);
  assert.ok(l.title && l.before && l.after && l.before !== l.after);
}
assert.match(MONTHLY_COPY.review_requests.what, /שלושה/);

console.log('monthly task checks passed');
