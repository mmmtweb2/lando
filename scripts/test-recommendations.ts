// Run: npx tsx scripts/test-recommendations.ts
import assert from 'node:assert/strict';
import { WEIGHT, buildRecommendations } from '../client/src/lib/recommendations';

const item = (key: string, level: 'good' | 'ok' | 'weak', avail: 'now' | 'soon' = 'soon') =>
  ({ key, label: key, level, value: '', tip: `tip-${key}`, weDo: `we-${key}`, weDoAvailability: avail, youDo: level === 'good' ? '' : `you-${key}` });

assert.equal(Object.values(WEIGHT).reduce((a, b) => a + b, 0), 100, 'weights match the score');
const all = ['rating', 'reviews', 'photos', 'phone', 'website', 'hours', 'category', 'status'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mk = (items: any[]) => ({ items }) as any;
let recs = buildRecommendations(mk(all.map((k) => item(k, 'weak', k === 'website' ? 'now' : 'soon'))));
assert.deepEqual(recs.map((r) => r.key), ['reviews', 'rating', 'photos', 'website', 'phone', 'hours', 'category', 'status'], 'sorted by points at stake (ties by weight)');
assert.equal(recs[0].impact, 'high'); assert.equal(recs[3].impact, 'medium'); assert.equal(recs[7].impact, 'low');
assert.equal(recs.find((r) => r.key === 'website')!.weDoLabel, 'נטפל בזה בשבילך אחרי ההרשמה');
assert.equal(recs.find((r) => r.key === 'rating')!.weDoLabel, 'בקרוב: נטפל בזה בשבילך', 'not yet available is said honestly');
assert.ok(recs.every((r) => r.why.length > 10 && r.how.length > 0), 'every item says why and how');

// "ok" items count half: weak photos (15) > ok reviews (12.5) > weak website (10).
recs = buildRecommendations(mk([item('reviews', 'ok'), item('photos', 'weak'), item('website', 'weak')]));
assert.deepEqual(recs.map((r) => r.key), ['photos', 'reviews', 'website']);
assert.equal(recs[1].level, 'ok');
// Good items never appear; no gaps = empty list.
assert.deepEqual(buildRecommendations(mk(all.map((k) => item(k, 'good')))), []);
// Falls back to the tip when the customer has nothing to do themselves.
const r2 = buildRecommendations(mk([{ ...item('reviews', 'weak'), youDo: '' }]));
assert.equal(r2[0].how, 'tip-reviews');
console.log('recommendations checks passed');
