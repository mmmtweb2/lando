// Run: npx tsx scripts/test-dashboard-v3.ts   (imports client ES modules)
// The pure model behind the dashboard v3 screens: chips, minutes, summary, "later", flash texts.
import assert from 'node:assert/strict';
import { buildMonthTasks, buildSetupTasks, flashText, minutesLine, needOf, nextOpenAfter, summarize, visibleRows, waitingTitle } from '../client/src/dashboard/v3/tasks';
import { MONTH_PARTS, SETUP_PARTS } from '../client/src/dashboard/v3/copy';
import { GUIDED_IDS } from '../client/src/dashboard/guided';
import { MONTHLY_IDS, deriveMonthly, freshMonth, type MonthlyData } from '../client/src/dashboard/monthly';
import type { OverviewInput } from '../client/src/dashboard/journey';

const input: OverviewInput = { loaded: true, businessName: 'x', hasBusiness: true, contentCount: 0, monthLeads: 0, subscriptionStatus: null, ticks: [] };

// 1. every task has all three parts, and none of the texts promises ranking or claims auto-update
for (const id of GUIDED_IDS) for (const k of ['what', 'how', 'you'] as const) assert.ok(SETUP_PARTS[id][k].length > 5, `${id}.${k}`);
for (const id of MONTHLY_IDS) for (const k of ['what', 'how', 'you'] as const) assert.ok(MONTH_PARTS[id][k].length > 5, `${id}.${k}`);
const all = [...Object.values(SETUP_PARTS), ...Object.values(MONTH_PARTS)].flatMap((p) => [p.what, p.how, p.you, p.howPremium ?? '', p.youPremium ?? '']).join(' ');
for (const bad of ['דירוג', 'ChatGPT', 'אוטומטית בגוגל', '₪']) assert.ok(!all.includes(bad), `no "${bad}"`);

// 2. chip order
assert.equal(needOf('setup', 'connect', true, false), 'none', 'done -> nothing needed');
assert.equal(needOf('setup', 'connect', false, false), 'need');
assert.equal(needOf('setup', 'first_check', false, false), 'none', 'the check starts by itself');
assert.equal(needOf('setup', 'profile_details', false, true), 'approve', 'premium approves');
assert.equal(needOf('setup', 'profile_details', false, false), 'need');
assert.equal(needOf('month', 'tracking', false, false), 'need');

// 3. setup tasks follow guided.ts: five, in order, current is the first open one
let s = buildSetupTasks({ ...input, hasBusiness: false }, []);
assert.deepEqual(s.tasks.map((t) => t.id), GUIDED_IDS);
assert.equal(s.currentKey, 's:connect');
s = buildSetupTasks({ ...input, ticks: ['first_check'] }, []);
assert.equal(s.currentKey, 's:profile_details');
assert.equal(s.tasks.find((t) => t.id === 'first_check')!.done, true);
assert.equal(s.tasks.find((t) => t.id === 'first_check')!.minutes, 0);
// postponed goes to the back, exactly like the v2 screen
s = buildSetupTasks({ ...input, ticks: ['first_check'] }, ['profile_details']);
assert.equal(s.currentKey, 's:profile_verified');
// premium: we do it, customer approves
s = buildSetupTasks({ ...input, ticks: ['first_check'], premium: { expectedBy: '2026-11-12' } }, []);
const prem = s.tasks.find((t) => t.id === 'profile_details')!;
assert.equal(prem.chip, 'approve');
assert.equal(prem.you, SETUP_PARTS.profile_details.youPremium);
assert.equal(prem.confirmQ.includes('מאשר'), true, 'premium keeps its own confirm question');

// 4. monthly tasks + summary
const data = (o: Partial<MonthlyData> = {}, i: Partial<OverviewInput> = {}): MonthlyData => ({ input: { ...input, ...i }, requestsSent: 0, pendingReplies: null, ...o });
const st = freshMonth('2026-11', 0);
let m = buildMonthTasks(deriveMonthly(data(), st));
assert.deepEqual(m.map((t) => t.id), ['review_requests', 'search_phrases', 'tracking']);
let sum = summarize(m);
assert.deepEqual([sum.total, sum.done, sum.waiting, sum.minutes, sum.allDone], [3, 0, 3, 5 + 10 + 5, false]);
m = buildMonthTasks(deriveMonthly(data({ requestsSent: 3 }, { monthLeads: 4 }), st));
sum = summarize(m);
assert.deepEqual([sum.done, sum.waiting, sum.minutes], [2, 1, 10], 'done tasks do not count');
assert.deepEqual(visibleRows(m, true).map((t) => t.id), ['search_phrases']);
assert.equal(visibleRows(m, false).length, 3);
m = buildMonthTasks(deriveMonthly(data({ requestsSent: 3 }, { monthLeads: 4, contentCount: 1 }), st));
sum = summarize(m);
assert.equal(sum.allDone, true);
assert.equal(visibleRows(m, true).length, 0, 'rest state');
assert.equal(waitingTitle(0), 'אין כרגע משהו שמחכה לכם');
assert.equal(waitingTitle(1), 'מחכה לכם משימה אחת');
assert.equal(waitingTitle(3), 'מחכות לכם 3 משימות');
assert.equal(minutesLine(0), 'בלי זמן מכם');
assert.equal(minutesLine(15), 'כ-15 דקות מכם');

// 5. "later" in the monthly phase only moves on
m = buildMonthTasks(deriveMonthly(data(), st));
assert.equal(nextOpenAfter(m, 'm:review_requests')?.id, 'search_phrases');
assert.equal(nextOpenAfter(m, 'm:tracking')?.id, 'review_requests', 'wraps around');
const onlyOne = buildMonthTasks(deriveMonthly(data({ requestsSent: 3 }, { monthLeads: 1 }), st));
assert.equal(nextOpenAfter(onlyOne, 'm:search_phrases'), null, 'nothing else open');

// 6. flash texts
assert.equal(flashText('חיבור העסק', 'בדיקה ראשונה'), 'כל הכבוד, ״חיבור העסק״ הושלם. הבא בתור: בדיקה ראשונה.');
assert.ok(flashText('x', null).includes('אין עוד משימות פתוחות'));

console.log('dashboard v3: all assertions passed');
