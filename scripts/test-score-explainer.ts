// Run: npx tsx scripts/test-score-explainer.ts   (imports a client ES module)
// Task #32: the note next to the score that explains why a business above the median is measured against the highest.
import assert from 'node:assert/strict';
import { scoreExplainer } from '../client/src/lib/auditShared';

const bm = (kind: 'median' | 'max', reviewsTarget: number) => ({
  count: 12, medianRating: 4.5, medianReviews: 40, topReviews: 300, maxReviews: 650, ratingTarget: 4.7, reviewsTarget, reviewsTargetKind: kind,
});

// no benchmark: nothing to explain
assert.equal(scoreExplainer({ reviewCount: 10, benchmark: null }), null);

// above the median: measured vs the highest, with the numbers and the gap
const hi = scoreExplainer({ reviewCount: 120, benchmark: bm('max', 650) });
assert.ok(hi && hi.vsHighest);
assert.match(hi.title, /הגבוה ביותר/);
assert.ok(hi.text.includes('650') && hi.text.includes('40') && hi.text.includes('120'), 'shows highest, median and own count');
assert.ok(hi.text.includes('530'), 'gap = 650 - 120');
assert.ok(hi.text.includes('לא אומר שהכרטיס נפגע'), 'says the card did not get worse');

// already at the highest: no "missing N"
const top = scoreExplainer({ reviewCount: 650, benchmark: bm('max', 650) });
assert.ok(top && top.text.includes('כבר הגעתם אליו') && !top.text.includes('חסרות'));

// below the median: says what the score is measured against and what comes next
const lo = scoreExplainer({ reviewCount: 5, benchmark: bm('median', 40) });
assert.ok(lo && !lo.vsHighest && lo.text.includes('40') && lo.text.includes('650'));

// never promises ranking
for (const e of [hi, top, lo]) assert.ok(e && !/דירוג בגוגל|נעלה|מקום ראשון|מובטח|נבטיח/.test(e.text), 'no ranking promise');
console.log('score explainer checks passed');
