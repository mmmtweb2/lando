// Run: npx tsx scripts/test-landing-prefill.ts   (pure helpers, no network, no DB)
import assert from 'node:assert/strict';
import { DRAFT_NOTICE, PREFILL_DAILY_LIMIT, hoursText, mapPlaceToPrefill, underPrefillLimit } from '../src/services/landingPrefill.service';

const place: any = {
  id: 'p1', displayName: { text: ' סטודיו דנה ' }, formattedAddress: 'דיזנגוף 100, תל אביב-יפו',
  nationalPhoneNumber: '03-123-4567', websiteUri: 'https://example.co.il/', primaryTypeDisplayName: { text: 'מספרה' },
  regularOpeningHours: { weekdayDescriptions: ['יום ראשון: 09:00–18:00', 'יום שני: 09:00–18:00', 7, 'יום שבת: סגור'] },
  photos: [{ name: 'x' }], rating: 4.8, userRatingCount: 120, reviews: [{ text: 'secret' }],
};
const p = mapPlaceToPrefill(place);
assert.equal(p.business_name, 'סטודיו דנה');
assert.equal(p.phone_number, '031234567');
assert.equal(p.address, 'דיזנגוף 100, תל אביב-יפו');
assert.equal(p.category, 'מספרה');
assert.equal(p.website, 'https://example.co.il/');
assert.equal(p.business_hours, 'יום ראשון: 09:00–18:00\nיום שני: 09:00–18:00\nיום שבת: סגור');
// never carries photos, reviews or ratings
assert.deepEqual(Object.keys(p).sort(), ['address', 'business_hours', 'business_name', 'category', 'phone_number', 'website']);

// missing / hostile fields degrade to empty strings
const q = mapPlaceToPrefill({ id: 'p2', websiteUri: 'javascript:alert(1)', regularOpeningHours: 'bad' } as any);
assert.deepEqual(q, { business_name: '', phone_number: '', address: '', business_hours: '', category: '', website: '' });
assert.equal(hoursText(undefined), '');
assert.equal(hoursText({ weekdayDescriptions: new Array(20).fill('x') }).split('\n').length, 7);

// daily cap per account, resets next day
const day1 = new Date('2026-11-04T10:00:00Z'), day2 = new Date('2026-11-05T10:00:00Z');
for (let i = 0; i < PREFILL_DAILY_LIMIT; i++) assert.equal(underPrefillLimit('a@x.co', day1), true);
assert.equal(underPrefillLimit('a@x.co', day1), false);
assert.equal(underPrefillLimit('b@x.co', day1), true);
assert.equal(underPrefillLimit('a@x.co', day2), true);

assert.ok(DRAFT_NOTICE.includes('טיוטה') && DRAFT_NOTICE.includes('גוגל'));
console.log('landing prefill checks passed');
