// Run: npx tsx scripts/test-what-promotes.ts   (imports client ES modules)
import assert from 'node:assert/strict';
import {
  SEEN_KEY, WHAT_PROMOTES_CLOSING, WHAT_PROMOTES_INTRO, WHAT_PROMOTES_POINTS, WHAT_PROMOTES_SOURCE, WHAT_PROMOTES_TITLE, initialOpen,
} from '../client/src/dashboard/whatPromotesData';

// 1. first visit opens, every later visit is collapsed
assert.equal(initialOpen(null), true);
assert.equal(initialOpen(undefined), true);
assert.equal(initialOpen(''), true);
assert.equal(initialOpen('garbage'), true);
assert.equal(initialOpen('1'), false);

// 2. per-account key
assert.ok(SEEN_KEY.endsWith(':'));
assert.notEqual(SEEN_KEY + 'a@x.com', SEEN_KEY + 'b@x.com');

// 3. the approved wording is kept as given (David's text, approved by Avi)
assert.equal(WHAT_PROMOTES_TITLE, 'מה מקדם עסק בגוגל');
assert.equal(WHAT_PROMOTES_INTRO, 'גוגל מחליטה מי מופיע לפי שלושה דברים: התאמה למה שמחפשים, מרחק מהמחפש, ומידת ההיכרות עם העסק.');
assert.deepEqual(WHAT_PROMOTES_POINTS.map((p) => p.label), ['התאמה', 'היכרות']);
assert.equal(WHAT_PROMOTES_CLOSING, 'מרחק אי אפשר לשנות, ואי אפשר לשלם לגוגל על דירוג טוב יותר, לכן אנחנו לא מבטיחים מקום.');
assert.equal(WHAT_PROMOTES_SOURCE.url, 'https://support.google.com/business/answer/7091');
assert.equal(WHAT_PROMOTES_SOURCE.label, 'מקור: מרכז העזרה של גוגל');

// 4. no promise, no jargon, no automatic-update claims in the whole text
const all = [WHAT_PROMOTES_INTRO, ...WHAT_PROMOTES_POINTS.map((p) => p.text), WHAT_PROMOTES_CLOSING].join(' ');
for (const bad of ['מובטח', 'מבטיחים מקום ', 'מקום ראשון', 'SEO', 'אלגוריתם', 'אוטומטית בגוגל', 'Google Business Profile']) {
  assert.ok(!all.includes(bad), `forbidden phrase: ${bad}`);
}
assert.ok(all.includes('לא מבטיחים מקום'));

console.log('test-what-promotes: ok');
