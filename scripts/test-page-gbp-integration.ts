// The landing page and the Google listing, shared both ways (README part 143). No network, no database:
// Google, storage and the tables are fakes. Run: npx tsx scripts/test-page-gbp-integration.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'assert';
import fs from 'fs';
import sharp from 'sharp';
import { emptyCard, type TruthCard } from '../src/services/businessTruth';
import { type GbpReview, listReviewsWithSummary, parseReviewSummary } from '../src/services/gbpGoogle';
import { toGooglePhoto } from '../src/services/gbpPhotos';
import {
  REVIEWS_MIN_COUNT, REVIEWS_MIN_RATING, REVIEWS_SECTION_ID, SEND_GAP_MS, alreadySent, buildPageReviews, firstName, googleFormat, googlePhotoHost, hoursLines,
  meetsThreshold, newPagePhotos, originalText, pageFacts, photoAction, photoEligibility, readSent, reviewsForViewer, reviewsFresh, reviewsShowable, selectReviews, withCardFacts, withSent,
  type SentPhoto,
} from '../src/services/pageGoogle';
import {
  type BlockDeps, type ImportDeps, type SendDeps, type SyncRow, PageGoogleError, createPhotoQueue, googleBlockForPage, googleIdsOnPage, importGooglePhotos, linkOf, refreshReviews, sendPagePhoto,
} from '../src/services/pageGoogle.service';
import type { AiStore } from '../src/services/imageSlots';
import { DEFAULT_AUTOMATION, PHOTOS_MODES } from '../src/services/automation.service';
import { attrText, formatHours, practicalDetails, readPageGoogle, REVIEWS_SECTION_ID as CLIENT_SECTION_ID, reviewDate } from '../client/src/lib/pageGoogle';
import { PAGE_STRINGS, pageStrings } from '../client/src/i18n/pageStrings';
import { readImgMeta } from '../client/src/lib/landingImages';

const NOW = new Date('2026-11-22T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const rv = (id: string, rating: number, ago: number, text: string, reviewer: string | null = 'דנה כהן'): GbpReview => ({ id: `review-${id}`, rating, createdAt: daysAgo(ago), reviewer, hasReply: false, text });
const LONG = (s: string) => `${s} הגענו בזמן, קיבלנו הסבר ברור לפני שהתחלנו, והמחיר היה בדיוק מה שנאמר מראש.`;

(async () => {
  // ── Reviews: what the reviewer wrote, untouched ─────────────────────────────
  {
    assert.equal(originalText('שירות מעולה!'), 'שירות מעולה!');
    assert.equal(originalText('(Translated by Google) Great service\n\n(Original)\nשירות מעולה, ממליצה בחום'), 'שירות מעולה, ממליצה בחום', 'the original, never Google\'s translation');
    assert.equal(originalText('Super service\n\n(Translated by Google)\nשירות מעולה'), 'Super service');
    assert.equal(originalText('(Translated by Google) only a translation'), '', 'no original = not the reviewer\'s words');
    assert.equal(originalText('  רווחים בקצוות  '), 'רווחים בקצוות');
    const inner = 'שורה ראשונה!!\nשורה שנייה   עם רווחים ו😀';
    assert.equal(originalText(inner), inner, 'nothing inside the text is changed');

    assert.equal(firstName('דנה כהן'), 'דנה');
    assert.equal(firstName('Jean-Pierre Martin'), 'Jean-Pierre');
    assert.equal(firstName('  Moshe  '), 'Moshe');
    assert.equal(firstName(null), null);
    assert.equal(firstName('A Google User'), null);
    assert.equal(firstName('me@example.com'), null);
    assert.equal(firstName('https://spam.example'), null);
  }

  // ── Reviews: selection ──────────────────────────────────────────────────────
  {
    const list: GbpReview[] = [
      rv('a', 5, 10, LONG('מעולה.')),
      rv('b', 5, 40, LONG('מקצועיים.'), 'Yossi Levi'),
      rv('c', 4, 5, LONG('טוב מאוד.'), 'רון'),
      rv('d', 3, 2, LONG('בסדר.')),                         // 3 stars: never
      rv('e', 1, 1, LONG('גרוע.')),                         // 1 star: never
      rv('f', 5, 3, ''),                                    // no text: never
      rv('g', 5, 900, LONG('ישן.')),                        // old: loses to recent ones
      rv('h', 5, 20, LONG('אדיבים.'), null),                // anonymous
      rv('i', 5, 1, 'מעולה'),                               // too short
    ];
    const sel = selectReviews(list, NOW);
    assert.equal(sel.length, 4, '4 reviews shown');
    assert.ok(sel.every((r) => r.rating >= 4), 'only 4-5 stars');
    assert.ok(sel.every((r) => r.text.length >= 20), 'only reviews with a real text');
    assert.ok(!sel.some((r) => r.text.includes('ישן')), 'a 2.5-year-old review loses to recent ones');
    assert.deepEqual(sel.map((r) => r.date), [...sel.map((r) => r.date)].sort().reverse(), 'newest first');
    assert.ok(sel.some((r) => r.name === null), 'an anonymous review keeps no name (the page writes "ביקורת מגוגל")');
    assert.ok(sel.some((r) => r.name === 'Yossi'), 'first name only');
    assert.ok(!JSON.stringify(sel).includes('כהן') && !JSON.stringify(sel).includes('Levi'), 'no last names stored');
    assert.ok(sel.every((r) => list.some((x) => x.text === r.text)), 'texts exactly as written');
    // short ones only fill in when there are not enough detailed ones
    const fewDetailed = selectReviews([rv('x', 5, 3, 'שירות מהיר ואדיב מאוד'), rv('y', 5, 4, LONG('מעולה.'))], NOW);
    assert.equal(fewDetailed.length, 2);
    assert.deepEqual(selectReviews([rv('z', 3, 1, LONG('x'))], NOW), [], 'nothing to show');
  }

  // ── Reviews: display threshold ──────────────────────────────────────────────
  {
    assert.equal(REVIEWS_MIN_COUNT, 5); assert.equal(REVIEWS_MIN_RATING, 4.3);
    assert.ok(meetsThreshold(4.3, 5) && meetsThreshold(5, 120) && meetsThreshold(4.26, 5), '4.26 shows as 4.3');
    assert.ok(!meetsThreshold(4.2, 50), 'under 4.3: not shown');
    assert.ok(!meetsThreshold(5, 4), 'under 5 reviews: not shown');
    const list = [rv('a', 5, 10, LONG('מעולה.')), rv('b', 5, 40, LONG('טוב.'))];
    assert.equal(buildPageReviews(list, { average: 4.2, total: 80 }, null, NOW), null, 'below the threshold the section silently does not render');
    assert.equal(buildPageReviews(list, { average: 4.9, total: 3 }, null, NOW), null);
    assert.equal(buildPageReviews(list, null, null, NOW), null, 'no numbers from Google: nothing');
    assert.equal(buildPageReviews([rv('c', 2, 1, LONG('x'))], { average: 4.8, total: 40 }, null, NOW), null, 'no review with text to show: nothing');
    const ok = buildPageReviews(list, { average: 4.84, total: 37 }, 'https://maps.google.com/?cid=1', NOW)!;
    assert.equal(ok.rating, 4.8); assert.equal(ok.count, 37); assert.equal(ok.items.length, 2);
    // attribution data: the listing's link travels with the reviews; only https
    assert.equal(ok.mapsUrl, 'https://maps.google.com/?cid=1');
    assert.equal(buildPageReviews(list, { average: 4.8, total: 37 }, 'javascript:alert(1)', NOW)!.mapsUrl, null);
    assert.equal(ok.fetchedAt, NOW.toISOString());
    // freshness: refreshed after 24h, not shown after 7 days without a successful read
    assert.ok(reviewsFresh(daysAgo(0.5), NOW) && !reviewsFresh(daysAgo(1.1), NOW) && !reviewsFresh(null, NOW));
    assert.ok(reviewsShowable(daysAgo(6), NOW) && !reviewsShowable(daysAgo(8), NOW));
    // the owner's quiet switch
    assert.equal(REVIEWS_SECTION_ID, CLIENT_SECTION_ID, 'same section id on both sides');
    assert.equal(reviewsForViewer(ok, ['google_reviews'], false), null, 'hidden: visitors do not get them');
    assert.equal(reviewsForViewer(ok, ['google_reviews'], true), ok, 'the owner still does (to switch back)');
    assert.equal(reviewsForViewer(ok, ['faq_accordion'], false), ok);
  }

  // ── Google's answer: rating and count ───────────────────────────────────────
  {
    assert.deepEqual(parseReviewSummary({ averageRating: 4.7, totalReviewCount: 52 }), { average: 4.7, total: 52 });
    assert.equal(parseReviewSummary({ averageRating: 0, totalReviewCount: 0 }), null);
    assert.equal(parseReviewSummary({}), null);
    const calls: string[] = [];
    const f = (async (url: any) => { calls.push(String(url)); return new Response(JSON.stringify({ averageRating: 4.6, totalReviewCount: 12, reviews: [{ reviewId: 'abcdef', starRating: 'FIVE', createTime: daysAgo(3), comment: 'מצוין מאוד מאוד מאוד', reviewer: { displayName: 'Avi B' } }] }), { status: 200 }); }) as typeof fetch;
    const r = await listReviewsWithSummary('tok', 'accounts/1', 'locations/2', f);
    assert.equal(r.summary?.total, 12); assert.equal(r.reviews.length, 1);
    assert.ok(calls[0].startsWith('https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews'), 'the Business Profile API of the owner\'s own listing (not Places)');
  }

  // ── Practical details from the business card ────────────────────────────────
  {
    const card: TruthCard = {
      ...emptyCard(), phone: '04-8123456', address: 'הרצל 12, חיפה', open: true,
      hours: [
        { day: 'SUNDAY', open: '09:00', close: '19:00' }, { day: 'MONDAY', open: '09:00', close: '19:00' }, { day: 'TUESDAY', open: '09:00', close: '19:00' },
        { day: 'WEDNESDAY', open: '09:00', close: '19:00' }, { day: 'THURSDAY', open: '09:00', close: '19:00' }, { day: 'FRIDAY', open: '08:00', close: '14:00' },
      ],
      serviceArea: { type: 'CUSTOMER_AND_BUSINESS_LOCATION', places: [{ name: 'חיפה', placeId: 'ChIJxxxxxxxxxx' }, { name: 'נשר', placeId: '' }] },
      attributes: {
        'attributes/has_wheelchair_accessible_entrance': true, 'attributes/has_wheelchair_accessible_parking': true,
        'attributes/has_free_parking_lot': true, 'attributes/has_paid_street_parking': false, 'attributes/pay_credit_card': true,
      },
    };
    const meta = [{ name: 'attributes/has_wheelchair_accessible_entrance', label: 'כניסה נגישה לכיסא גלגלים', group: 'נגישות' }];
    const f = pageFacts(card, meta);
    assert.equal(f.phone, '04-8123456'); assert.equal(f.address, 'הרצל 12, חיפה');
    assert.deepEqual(f.areas, ['חיפה', 'נשר']);
    assert.deepEqual(f.accessibility.map((a) => a.id), ['has_wheelchair_accessible_entrance', 'has_wheelchair_accessible_parking']);
    assert.equal(f.accessibility[0].label, 'כניסה נגישה לכיסא גלגלים', 'Google\'s own Hebrew name');
    assert.deepEqual(f.parking.map((a) => a.id), ['has_free_parking_lot'], 'only YES; accessible parking is under accessibility; payments are not practical details');
    assert.equal(pageFacts({ ...card, serviceArea: { type: 'CUSTOMER_LOCATION_ONLY', places: [] } }).address, '', 'an address the listing hides is never shown');
    assert.deepEqual(pageFacts({ ...card, open: false }).hours, [], 'closed in Google: no opening hours');
    assert.equal(hoursLines(f.hours), 'א׳-ה׳ 09:00-19:00\nו׳ 08:00-14:00');
    // server-rendered content (SEO body, JSON-LD) says the same as the page
    const content = { contact: { phone: '050-0000000', address: 'ישן', business_hours: 'ישן', whatsapp_message: 'שלום' }, hero: { title: 'x' } };
    const he = withCardFacts(content, f, 'he') as typeof content;
    assert.equal(he.contact.phone, '04-8123456'); assert.equal(he.contact.address, 'הרצל 12, חיפה'); assert.equal(he.contact.business_hours, 'א׳-ה׳ 09:00-19:00\nו׳ 08:00-14:00');
    assert.equal(he.contact.whatsapp_message, 'שלום', 'everything else untouched');
    assert.equal((withCardFacts(content, f, 'en') as typeof content).contact.business_hours, 'ישן', 'other languages keep their translated hours text');
    assert.equal(withCardFacts(content, null), content, 'not linked: the page\'s own');
    assert.equal(content.contact.phone, '050-0000000', 'never mutates');

    // client: one source per detail
    const own = { phone: '050-0000000', address: 'כתובת בדף', hours: 'שעות בדף', areas: '', parking: 'חניה ברחוב', accessibility: '' };
    const T = pageStrings('he');
    const p = practicalDetails(own, readPageGoogle({ facts: JSON.parse(JSON.stringify(f)) })!.facts, 'he', T);
    assert.equal(p.phone, '04-8123456'); assert.equal(p.address, 'הרצל 12, חיפה');
    assert.equal(p.hours, 'א׳-ה׳ 09:00-19:00\nו׳ 08:00-14:00', 'client and server write the hours the same way');
    assert.equal(p.areas, 'חיפה, נשר');
    assert.equal(p.accessibility, 'כניסה נגישה לכיסא גלגלים, חניית נכים');
    assert.equal(p.parking, 'חניון חינם');
    assert.deepEqual(p.fromCard.sort(), ['accessibility', 'address', 'areas', 'hours', 'parking', 'phone']);
    const en = practicalDetails(own, readPageGoogle({ facts: f })!.facts, 'en', pageStrings('en'));
    assert.equal(en.hours, 'Sun-Thu 09:00-19:00\nFri 08:00-14:00');
    assert.equal(en.accessibility, 'Wheelchair-accessible entrance, Wheelchair-accessible parking', 'fixed words per language, never Hebrew on an English page');
    assert.equal(attrText([{ id: 'unknown_attr', label: 'משהו' }], 'fr', pageStrings('fr')), '', 'an unknown attribute is left out in another language');
    const empty = practicalDetails(own, { phone: '', address: '', hours: [], areas: [], parking: [], accessibility: [] }, 'he', T);
    assert.deepEqual({ ...empty, fromCard: [] }, { ...own, fromCard: [] }, 'the card has no value: the page keeps its own text');
    assert.deepEqual(practicalDetails(own, null, 'he', T).fromCard, [], 'not linked: nothing from the card');
    assert.equal(formatHours([], T.days), '');
    for (const [lang, s] of Object.entries(PAGE_STRINGS)) {
      assert.equal(s!.days.length, 7, `${lang}: 7 days`);
      assert.ok(s!.reviews.fromGoogle && s!.reviews.seeAll && s!.reviews.count(3) && s!.guide.areas, `${lang}: reviews words`);
      assert.ok(Object.keys(s!.attrs).length >= 10, `${lang}: attribute words`);
    }
    assert.equal(PAGE_STRINGS.he!.reviews.fromGoogle, 'ביקורות מגוגל');
    assert.ok(reviewDate('2026-11-14', 'he-IL').includes('2026'));
    // malformed data from the server is dropped
    const g = readPageGoogle({ facts: { hours: [{ day: 'FUNDAY', open: '1', close: '2' }] }, reviews: { rating: 4.8, count: 9, items: [{ text: '', rating: 5 }] } })!;
    assert.deepEqual(g.facts!.hours, []); assert.equal(g.reviews, null);
  }

  // ── Which page is linked ────────────────────────────────────────────────────
  {
    const deps = (o: Partial<{ biz: string | null; loc: string | null; truthLoc: string | null }> = {}) => ({
      businessPageId: async () => ('biz' in o ? o.biz! : 'page-1'),
      connectedLocation: async () => ('loc' in o ? o.loc! : 'locations/9'),
      truth: async () => ({ card: emptyCard(), location: 'truthLoc' in o ? o.truthLoc! : 'locations/9', meta: [] }),
    });
    const page = { id: 'page-1', owner_email: 'Owner@X.co', parent_id: null };
    assert.equal((await linkOf(page, deps()))?.email, 'owner@x.co');
    assert.equal(await linkOf({ ...page, parent_id: 'p0' }, deps()), null, 'a child page is never linked');
    assert.equal(await linkOf(page, deps({ biz: 'page-2' })), null, 'another page of the account is not the business page');
    assert.equal(await linkOf(page, deps({ loc: null })), null, 'not connected');
    assert.equal(await linkOf(page, deps({ truthLoc: 'locations/1' })), null, 'the card describes another listing');
    assert.equal(await linkOf({ ...page, owner_email: null }, deps()), null);
  }

  // ── Reviews refresh and the page block ──────────────────────────────────────
  {
    let row: SyncRow | null = null;
    let reads = 0;
    const rdeps = {
      access: async () => 'tok',
      account: async () => 'accounts/7',
      reviews: async () => { reads++; return { reviews: [rv('a', 5, 2, LONG('מעולה.')), rv('b', 5, 9, LONG('אדיבים.'))], summary: { average: 4.9, total: 23 } }; },
      row: async () => row,
      save: async (_e: string, p: Partial<SyncRow>) => { row = { location_name: null, account_name: null, reviews: null, reviews_fetched_at: null, sent_photos: [], ...(row ?? {}), ...p }; return true; },
      revoked: async () => undefined,
    };
    assert.equal(await refreshReviews('o@x.co', 'locations/9', 'https://maps.google.com/?cid=9', NOW, rdeps), 'saved');
    assert.equal(row!.account_name, 'accounts/7'); assert.equal(row!.reviews!.count, 23); assert.equal(row!.reviews!.mapsUrl, 'https://maps.google.com/?cid=9');
    assert.equal(await refreshReviews('o@x.co', 'locations/9', null, NOW, { ...rdeps, row: async () => 'missing' as const }), 'missing', 'before migration 055: nothing');
    assert.equal(await refreshReviews('p@x.co', 'locations/9', null, NOW, { ...rdeps, access: async () => null }), 'not_connected');
    assert.equal(await refreshReviews('q@x.co', 'locations/9', null, NOW, { ...rdeps, reviews: async () => { throw new Error('boom'); } }), 'failed');
    assert.equal(await refreshReviews('q@x.co', 'locations/9', null, NOW, rdeps), 'backoff', 'after a failure, no new read for an hour');

    const link = { businessPageId: async () => 'pg', connectedLocation: async () => 'locations/9', truth: async () => ({ card: { ...emptyCard(), phone: '04-1' }, location: 'locations/9', meta: [] }) };
    const bdeps: BlockDeps = { link, reviews: rdeps, now: () => NOW };
    const visitor = await googleBlockForPage({ id: 'pg', owner_email: 'o@x.co', ai_content: {} }, false, bdeps);
    assert.equal(visitor!.reviews!.items.length, 2); assert.equal(visitor!.facts!.phone, '04-1'); assert.equal(visitor!.linked, undefined, 'visitors are not told about the link');
    const hiddenPage = { id: 'pg', owner_email: 'o@x.co', ai_content: { hidden_sections: ['google_reviews'] } };
    assert.equal((await googleBlockForPage(hiddenPage, false, bdeps))!.reviews, null);
    assert.ok((await googleBlockForPage(hiddenPage, true, bdeps))!.reviews && (await googleBlockForPage(hiddenPage, true, bdeps))!.linked);
    const before = reads;
    await googleBlockForPage({ id: 'pg', owner_email: 'o@x.co' }, false, bdeps);
    assert.equal(reads, before, 'fresh cache: Google is not read on a page view');
    const other = await googleBlockForPage({ id: 'pg-other', owner_email: 'o@x.co' }, false, { ...bdeps, link: { ...link, businessPageId: async () => 'pg' } });
    assert.equal(other, null, 'a page that is not linked gets nothing');
    const crash = await googleBlockForPage({ id: 'pg-crash', owner_email: 'o@x.co' }, false, { ...bdeps, link: { ...link, businessPageId: async () => { throw new Error('db down'); } } });
    assert.equal(crash, null, 'never fails the page');
  }

  // ── Photos: which page photos may go to Google ─────────────────────────────
  {
    const ours = (u: string) => u.startsWith('https://store.test/');
    const store: AiStore = {
      hero_image_url: 'https://store.test/hero.webp',
      icon_urls: ['https://images.unsplash.com/photo-1', ''],
      gallery_urls: ['https://store.test/g1.webp', 'https://store.test/logo.webp', 'https://store.test/tiny.webp', 'https://store.test/fromg.webp', 'https://store.test/ai.webp'],
      img_meta: {
        'https://store.test/hero.webp': { w: 1600, h: 1067, alt: 'x' },
        'https://store.test/g1.webp': { w: 1200, h: 800 },
        'https://store.test/logo.webp': { w: 300, h: 300, logo: true },
        'https://store.test/tiny.webp': { w: 300, h: 200 },
        'https://store.test/fromg.webp': { w: 1200, h: 900, from: 'google', gid: 'AF1Qip' },
      },
    };
    const get = (u: string) => ({ url: u, meta: store.img_meta![u] });
    assert.deepEqual(photoEligibility(get('https://store.test/hero.webp'), null, ours), { ok: true });
    assert.deepEqual(photoEligibility(get('https://store.test/logo.webp'), null, ours), { ok: false, reason: 'logo' });
    assert.deepEqual(photoEligibility({ url: 'https://store.test/g1.webp', meta: { w: 1200, h: 800 } }, 'https://store.test/g1.webp', ours), { ok: false, reason: 'logo' }, 'the page logo never goes');
    assert.deepEqual(photoEligibility(get('https://store.test/tiny.webp'), null, ours), { ok: false, reason: 'small' }, 'under 250 px');
    assert.deepEqual(photoEligibility(get('https://store.test/fromg.webp'), null, ours), { ok: false, reason: 'from_google' }, 'a photo from Google is never sent back');
    assert.deepEqual(photoEligibility(get('https://store.test/ai.webp'), null, ours), { ok: false, reason: 'not_uploaded' }, 'stock and generated pictures do not stand for the business on Google');
    assert.deepEqual(photoEligibility(get('https://images.unsplash.com/photo-1'), null, ours), { ok: false, reason: 'host' });
    assert.deepEqual(newPagePhotos(store, null, [], ours).map((p) => p.url), ['https://store.test/hero.webp', 'https://store.test/g1.webp']);
    assert.deepEqual(newPagePhotos(['https://store.test/a.webp'], null, [], ours), [], 'an old array page has no upload details: nothing automatic');

    // dedupe
    const sent: SentPhoto[] = [{ u: 'https://store.test/hero.webp', h: 'aaa', m: 'm1', o: 'page', at: NOW.toISOString() }];
    assert.ok(alreadySent(sent, 'https://store.test/hero.webp'));
    assert.ok(alreadySent(sent, 'https://store.test/other.webp', 'aaa'), 'the same bytes under another address');
    assert.ok(!alreadySent(sent, 'https://store.test/other.webp', 'bbb'));
    assert.deepEqual(newPagePhotos(store, null, sent, ours).map((p) => p.url), ['https://store.test/g1.webp']);
    let many: SentPhoto[] = [];
    for (let i = 0; i < 450; i++) many = withSent(many, { u: `u${i}`, o: 'page', at: '' });
    assert.equal(many.length, 400); assert.equal(many[399].u, 'u449');
    assert.equal(withSent(sent, { u: 'https://store.test/hero.webp', m: 'm2', o: 'page', at: '' }).length, 1, 'one record per address');
    assert.deepEqual(readSent([{ u: 'x', o: 'page' }, { u: 1, o: 'page' }, { u: 'y', o: 'hack' }, null]).map((s) => s.u), ['x']);

    // format: WebP becomes JPEG for Google; JPG/PNG are accepted as they are
    assert.equal(googleFormat('image/webp'), 'to_jpeg');
    assert.equal(googleFormat('image/jpeg'), 'as_is'); assert.equal(googleFormat('image/png'), 'as_is');
    assert.equal(googleFormat('image/gif'), null);
    const webp = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#3a6fb5' } }).webp().toBuffer();
    const jpeg = await toGooglePhoto(webp, 'image/webp');
    assert.equal((await sharp(jpeg.buffer).metadata()).format, 'jpeg', 'a WebP page photo reaches Google as a JPEG');
    const tinyWebp = await sharp({ create: { width: 240, height: 600, channels: 3, background: '#000' } }).webp().toBuffer();
    await assert.rejects(toGooglePhoto(tinyWebp, 'image/webp'), /small/, 'under 250 px is refused before Google');
  }

  // ── Photos: the owner's setting ─────────────────────────────────────────────
  {
    assert.deepEqual(PHOTOS_MODES, ['auto', 'ask', 'off']);
    assert.equal(DEFAULT_AUTOMATION.photosMode, 'auto', 'one smart default: automatic');
    const base = { mode: 'auto' as const, writeEnabled: true, linked: true, migrated: true };
    assert.equal(photoAction(base), 'send');
    assert.equal(photoAction({ ...base, mode: 'ask' }), 'suggest');
    assert.equal(photoAction({ ...base, mode: 'off' }), 'none');
    assert.equal(photoAction({ ...base, writeEnabled: false }), 'suggest', 'GBP_WRITEBACK_ENABLED off: nothing is written, the dashboard offers it later');
    assert.equal(photoAction({ ...base, linked: false }), 'none');
    assert.equal(photoAction({ ...base, migrated: false }), 'none', 'without 055 there is nowhere to remember what was sent: never automatic');
  }

  // ── Photos: sending once, paced ─────────────────────────────────────────────
  {
    let row: SyncRow | null = null;
    const listing: string[] = [];
    const bytes: Record<string, Buffer> = { a: Buffer.from('photo-a'), b: Buffer.from('photo-b'), acopy: Buffer.from('photo-a') };
    const deps = (o: Partial<SendDeps> = {}): SendDeps => ({
      row: async () => row,
      save: async (_e, p) => { row = { location_name: null, account_name: null, reviews: null, reviews_fetched_at: null, sent_photos: [], ...(row ?? {}), ...p }; return true; },
      fetchImage: async (_e, url) => ({ buffer: bytes[url], mime: 'image/webp' }),
      addToListing: async (_e, b) => { listing.push(b.toString()); return `media-${listing.length}`; },
      ...o,
    });
    assert.equal(await sendPagePhoto('o@x.co', 'a', 'page', deps(), NOW), 'sent');
    assert.equal(row!.sent_photos[0].m, 'media-1');
    assert.equal(await sendPagePhoto('o@x.co', 'a', 'page', deps(), NOW), 'duplicate', 'never twice by address');
    assert.equal(await sendPagePhoto('o@x.co', 'acopy', 'page', deps(), NOW), 'duplicate', 'never twice by content');
    assert.equal(listing.length, 1);
    // a failure that may pass frees the record; a crash after Google took it cannot cause a second send
    const fail = await sendPagePhoto('o@x.co', 'b', 'page', deps({ addToListing: async () => { throw new Error('quota'); } }), NOW);
    assert.equal(fail, 'failed'); assert.ok(!row!.sent_photos.some((s) => s.u === 'b'), 'freed for a later try');
    let reservedSeen = false;
    await sendPagePhoto('o@x.co', 'b', 'page', deps({ addToListing: async () => { reservedSeen = row!.sent_photos.some((s) => s.u === 'b' && !s.m); listing.push('b'); return 'media-b'; } }), NOW);
    assert.ok(reservedSeen, 'recorded BEFORE the call to Google');
    assert.equal(await sendPagePhoto('o@x.co', 'b', 'page', deps({ row: async () => 'missing' }), NOW), 'missing', 'before migration 055: never sent');

    // the queue: one after another, SEND_GAP_MS apart, a waiting photo is not queued twice
    const order: string[] = [];
    const sleeps: number[] = [];
    const q = createPhotoQueue(async (_e, u) => { order.push(u); if (u === 'bad') throw new Error('x'); }, async (ms) => { sleeps.push(ms); });
    assert.equal(q.add('o@x.co', ['1', '2', 'bad']), 3);
    assert.equal(q.add('o@x.co', ['2', '3']), 1, '"2" is already waiting');
    await q.idle('o@x.co');
    assert.deepEqual(order, ['1', '2', 'bad', '3'], 'one failure never stops the others');
    assert.ok(sleeps.length === 4 && sleeps.every((ms) => ms === SEND_GAP_MS) && SEND_GAP_MS >= 6000, 'at most 10 a minute per listing');
  }

  // ── Photos from Google into the page ────────────────────────────────────────
  {
    assert.ok(googlePhotoHost('https://lh3.googleusercontent.com/p/AF1Qip=s0'));
    assert.ok(!googlePhotoHost('https://evil.example/x.jpg') && !googlePhotoHost('http://lh3.googleusercontent.com/x') && !googlePhotoHost('https://googleusercontent.com.evil.io/x'));
    const page = { id: 'pg', owner_email: 'o@x.co', parent_id: null, user_images: JSON.stringify({ hero_image_url: 'https://store.test/h.webp', icon_urls: [], gallery_urls: ['https://store.test/g0.webp'], img_meta: { 'https://store.test/h.webp': { w: 1600, h: 900 } } }), logo_url: null, slug: 's', subdomain: null, status: 'published', business_name: 'מספרת דני', image_source: 'upload' };
    let saved = '';
    let sentRow: SyncRow | null = null;
    const fetched: string[] = [];
    const deps: ImportDeps = {
      listPhotos: async () => [
        { id: 'AF1QipA', url: 'https://lh3.googleusercontent.com/p/A', thumbUrl: 'https://lh3.googleusercontent.com/p/A=s300', category: 'INTERIOR', createdAt: null, state: 'live' },
        { id: 'AF1QipB', url: 'https://lh3.googleusercontent.com/p/B', thumbUrl: '', category: 'EXTERIOR', createdAt: null, state: 'live' },
        { id: 'AF1QipP', url: '', thumbUrl: '', category: 'ADDITIONAL', createdAt: null, state: 'processing' },
      ],
      fetchPhoto: async (u) => { fetched.push(u); return Buffer.from(u); },
      process: async (b) => ({ url: `https://store.test/google-${b.toString().slice(-1)}.webp`, meta: { w: 1200, h: 800, alt: 'תמונה' }, warning: null }),
      savePage: async (_id, ui) => { saved = ui; },
      row: async () => sentRow,
      saveRow: async (_e, p) => { sentRow = { location_name: null, account_name: null, reviews: null, reviews_fetched_at: null, sent_photos: [], ...(sentRow ?? {}), ...p }; return true; },
      log: async () => undefined,
    };
    const linker = async () => ({ email: 'o@x.co', location: 'locations/9' });
    const r = await importGooglePhotos('pg', ['AF1QipA', 'AF1QipB', 'AF1QipP', 'nope-not-there', '../../x'], deps, async () => page, linker);
    assert.equal(r.added, 2, 'only live photos the listing really has');
    assert.deepEqual(fetched, ['https://lh3.googleusercontent.com/p/A', 'https://lh3.googleusercontent.com/p/B'], 'only Google\'s own URLs from a fresh list, never a URL from the browser');
    const st = JSON.parse(saved) as AiStore;
    assert.deepEqual(st.gallery_urls, ['https://store.test/g0.webp', 'https://store.test/google-A.webp', 'https://store.test/google-B.webp'], 'into free gallery places, after what is there');
    assert.equal(st.img_meta!['https://store.test/google-A.webp'].from, 'google');
    assert.equal(st.img_meta!['https://store.test/google-A.webp'].gid, 'AF1QipA');
    assert.equal(st.hero_image_url, 'https://store.test/h.webp', 'the hero is untouched');
    assert.deepEqual([...googleIdsOnPage(st)].sort(), ['AF1QipA', 'AF1QipB']);
    assert.ok(sentRow!.sent_photos.every((s) => s.o === 'google'), 'recorded, so they are never sent back');
    assert.equal(newPagePhotos(st, null, sentRow!.sent_photos, (u) => u.startsWith('https://store.test/')).length, 1, 'only the owner\'s own hero is a candidate for Google');
    assert.equal(readImgMeta(st)['https://store.test/google-A.webp'].gid, 'AF1QipA', 'the client keeps the Google id (the picker marks it "כבר בדף")');
    // again with the same ids: nothing new
    await assert.rejects(importGooglePhotos('pg', ['AF1QipA'], deps, async () => ({ ...page, user_images: saved }), linker), (e: unknown) => e instanceof PageGoogleError && e.code === 'none');
    // full gallery
    const full = JSON.stringify({ hero_image_url: null, icon_urls: [], gallery_urls: Array.from({ length: 12 }, (_, i) => `https://store.test/f${i}.webp`) });
    await assert.rejects(importGooglePhotos('pg', ['AF1QipA'], deps, async () => ({ ...page, user_images: full }), linker), (e: unknown) => e instanceof PageGoogleError && e.code === 'full');
    // not linked
    await assert.rejects(importGooglePhotos('pg', ['AF1QipA'], deps, async () => page, async () => null), (e: unknown) => e instanceof PageGoogleError && e.code === 'not_linked');
  }

  // ── Wiring ──────────────────────────────────────────────────────────────────
  {
    const sql = fs.readFileSync('migrations/055_page_google.sql', 'utf8');
    assert.ok(/CREATE TABLE IF NOT EXISTS gbp_page_sync/.test(sql) && /ENABLE ROW LEVEL SECURITY/.test(sql) && /FORCE ROW LEVEL SECURITY/.test(sql), '055: idempotent, RLS enabled and forced');
    assert.ok(/ADD COLUMN IF NOT EXISTS photos_mode/.test(sql) && !/CREATE POLICY/i.test(sql), 'no policies: service role only');
    const routes = fs.readFileSync('src/routes/landing.routes.ts', 'utf8');
    assert.ok(/'\/:id\/google-photos', googlePhotosLimiter, requireAuth, requireOwnPage/.test(routes) && /'\/:id\/google-photos', aiLimiter, requireAuth, requireOwnPage/.test(routes), 'editor routes: owner only');
    const seo = fs.readFileSync('src/routes/seo.routes.ts', 'utf8');
    assert.ok(/'\/gbp\/page-link', \.\.\.profileGated/.test(seo) && /'\/gbp\/page-link\/photos', \.\.\.profileGated, photoLimiter/.test(seo), 'dashboard routes: signed in, with the product');
    const svc = fs.readFileSync('src/services/pageGoogle.service.ts', 'utf8');
    assert.ok(!/places\.googleapis|fetchPlaceReviews/.test(svc), 'no Places content is cached for the page');
    // copy: plural, no "AI"
    const copy = [fs.readFileSync('client/src/dashboard/v3/autopilot/PageLinkSection.tsx', 'utf8'), fs.readFileSync('client/src/pages/landingV3/GooglePhotosPicker.tsx', 'utf8')].join('\n');
    const hebrew = (copy.match(/'[^']*[֐-׿][^']*'|>[^<>{}]*[֐-׿][^<>{}]*</g) ?? []).join(' ');
    assert.ok(hebrew.length > 200);
    assert.ok(!/\bAI\b|בינה מלאכותית/.test(hebrew), 'no "AI"');
    assert.ok(!/(^|\s)(תבחר|תוסיף|תעלה|לחץ|בחר|הוסף)(\s|$)/.test(hebrew), 'plural second person');
  }

  console.log('page <-> Google listing checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
