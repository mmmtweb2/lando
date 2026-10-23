// Run: npx ts-node --transpile-only scripts/test-reviews-widget.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import { renderReviewsFallback, renderReviewsWidget, renderReviewsUnavailable, safeHttps, writeReviewUrl } from '../src/services/reviewsWidgetRender';

const PID = 'ChIJ_validplace1';
const data = {
  id: PID,
  displayName: { text: 'מרפאת <b>שורש</b>' },
  rating: 4.8,
  userRatingCount: 123,
  googleMapsUri: 'https://maps.google.com/?cid=1',
  reviews: [
    {
      rating: 5, relativePublishTimeDescription: 'לפני שבוע',
      text: { text: '<script>alert(1)</script> מעולה', languageCode: 'he' },
      originalText: { text: 'great', languageCode: 'en' },
      authorAttribution: { displayName: 'דנה "כהן"', uri: 'https://www.google.com/maps/contrib/1', photoUri: 'https://lh3.googleusercontent.com/a/x' },
      googleMapsUri: 'https://maps.google.com/?review=1', flagContentUri: 'https://www.google.com/flag/1',
    },
    {
      rating: 4, text: { text: 'ok', languageCode: 'he' },
      authorAttribution: { displayName: 'אורח', uri: 'javascript:alert(1)', photoUri: 'http://insecure/x.png' },
      googleMapsUri: 'javascript:alert(2)',
    },
    ...Array.from({ length: 6 }, (_, i) => ({ rating: 5, text: { text: `r${i}` }, authorAttribution: { displayName: `u${i}` } })),
  ],
};

const html = renderReviewsWidget(data, PID);
// escaping / XSS
assert.ok(!html.includes('<script>alert(1)'), 'review text escaped');
assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
assert.ok(!html.includes('<b>שורש</b>'), 'business name escaped');
assert.ok(html.includes('דנה &quot;כהן&quot;'), 'quotes escaped');
assert.ok(!html.includes('javascript:'), 'non-https links dropped');
assert.ok(!html.includes('http://insecure'), 'http avatar dropped');
// policy: attribution, author links, original link, flag, ordering note, authenticity note
assert.ok(html.includes('translate="no">Google Maps</span>'), 'Google Maps text attribution, untranslated');
assert.ok(html.includes('href="https://www.google.com/maps/contrib/1"'), 'author profile link');
assert.ok(html.includes('href="https://maps.google.com/?review=1"'), 'link to original review');
assert.ok(html.includes('https://www.google.com/flag/1'), 'flag link');
assert.ok(html.includes('לפי הרלוונטיות'), 'ordering explained');
assert.ok(html.includes('אינה מאמתת ביקורות'), 'authenticity note');
assert.ok(html.includes('תורגם על ידי Google'), 'translated review flagged');
// no structured data, capped at 5 reviews
assert.ok(!/ld\+json|aggregateRating/i.test(html), 'no JSON-LD / aggregateRating');
assert.equal((html.match(/class="rv"/g) ?? []).length, 5);
assert.ok(html.includes('noindex'));
assert.ok(html.includes(writeReviewUrl(PID)));

// fallback / unavailable carry NO Google content
const fb = renderReviewsFallback(PID);
assert.ok(fb.includes(writeReviewUrl(PID)));
assert.ok(!fb.includes('Google Maps</span>') && !fb.includes('class="rv"'));
assert.ok(!renderReviewsUnavailable().includes('search.google.com'));
assert.equal(safeHttps('http://x.co'), null);
assert.equal(safeHttps('https://x.co/a')?.startsWith('https://x.co'), true);
assert.equal(writeReviewUrl('A_b-1'), 'https://search.google.com/local/writereview?placeid=A_b-1');

// ── controller: guards ──
import { serveReviewsWidget, takeLiveFetch } from '../src/controllers/reviewsWidget.controller';
import { supabase } from '../src/config/supabase';

function res() {
  const r: any = { code: 200, body: '', headers: {} as Record<string, string> };
  r.status = (c: number) => { r.code = c; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k.toLowerCase()] = v; };
  r.removeHeader = (k: string) => { delete r.headers[k.toLowerCase()]; };
  r.send = (b: string) => { r.body = b; return r; };
  return r;
}
const BIZ = '11111111-1111-4111-8111-111111111111';
let bizRow: any = { id: BIZ, owner_email: 'o@x.co', google_place_id: PID };
let entitlement: any[] = [{ product: 'seo_autopilot', status: 'active', current_period_end: null }];
(supabase as any).from = (table: string) => {
  const q: any = {
    select: () => q, eq: () => q, order: () => q,
    maybeSingle: async () => ({ data: bizRow, error: null }),
    then: (ok: any) => ok({ data: entitlement, error: null }),
  };
  return q;
};
let fetchCalls = 0;
globalThis.fetch = (async () => { fetchCalls++; return new Response(JSON.stringify(data), { status: 200 }); }) as typeof fetch;

(async () => {
  process.env.GOOGLE_PLACES_API_KEY = 'K';
  let r = res(); await serveReviewsWidget({ params: { businessId: 'nope' } } as any, r);
  assert.equal(r.code, 404); assert.equal(fetchCalls, 0, 'invalid id never reaches Google');

  r = res(); await serveReviewsWidget({ params: { businessId: BIZ } } as any, r);
  assert.equal(r.code, 200); assert.ok(r.body.includes('class="rv"')); assert.equal(fetchCalls, 1);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.ok(r.headers['x-robots-tag'].includes('noindex'));
  assert.ok(!('x-frame-options' in r.headers));
  assert.ok(r.headers['content-security-policy'].includes('frame-ancestors *'));

  entitlement = [{ product: 'seo_autopilot', status: 'canceled', current_period_end: null }];
  const before = fetchCalls;
  r = res(); await serveReviewsWidget({ params: { businessId: BIZ } } as any, r);
  assert.equal(r.code, 404); assert.equal(fetchCalls, before, 'no Google call without entitlement');
  entitlement = [{ product: 'seo_autopilot', status: 'active', current_period_end: null }];

  bizRow = null;
  r = res(); await serveReviewsWidget({ params: { businessId: BIZ } } as any, r);
  assert.equal(r.code, 404);
  bizRow = { id: BIZ, owner_email: 'o@x.co', google_place_id: PID };

  // Google down -> degrade to the button, still 200
  globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
  r = res(); await serveReviewsWidget({ params: { businessId: BIZ } } as any, r);
  assert.equal(r.code, 200); assert.ok(r.body.includes(writeReviewUrl(PID))); assert.ok(!r.body.includes('class="rv"'));

  // per-business daily cap -> fallback without calling Google
  process.env.REVIEWS_WIDGET_DAILY_CAP = '3';
  const B2 = '22222222-2222-4222-8222-222222222222';
  assert.equal(takeLiveFetch(B2), true); assert.equal(takeLiveFetch(B2), true); assert.equal(takeLiveFetch(B2), true);
  assert.equal(takeLiveFetch(B2), false);
  assert.equal(takeLiveFetch('33333333-3333-4333-8333-333333333333'), true, 'other business unaffected');
  console.log('reviews widget checks passed');
})().catch(e => { console.error(e); process.exit(1); });
