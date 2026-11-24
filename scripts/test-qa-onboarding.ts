// Run: npx tsx scripts/test-qa-onboarding.ts
// QA 24.11 (README part 152): business search/selection in onboarding, ownership checks, audit
// sanity for a sparse listing, input validation, and the static first paint. No network, no DB.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_QUERY_LEN, NO_RESULT_TIPS, normalize, queryError, rankSuggestions, relevance, searchView,
} from '../client/src/lib/businessSearch';
import { passwordError } from '../client/src/lib/authErrors';
import { benchmarkNote, sparseExplainer, WEIGHT as CLIENT_WEIGHT, type Audit } from '../client/src/lib/auditShared';
import { buildRecommendations } from '../client/src/lib/recommendations';
import { buildAudit, buildBenchmark, LEADERS_SHOWN } from '../src/services/placesAudit';
import { placeMatch } from '../src/services/gbpPlaceMatch';
import { MAX_DISTINCT_PICKS_PER_DAY, resetSelections, takeSelection } from '../src/services/selectionGuard';
import { injectSeoBody, stripBootShell } from '../src/services/seoRender';
import { placesAutocomplete } from '../src/controllers/seo.controller';
import { publicSearch } from '../src/controllers/publicAudit.controller';
import type { Request, Response } from 'express';

let n = 0;
const ok = async (name: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log('ok  ', name); };

function mockRes() {
  const out: { status: number; body: unknown } = { status: 200, body: null };
  const res = {
    status(c: number) { out.status = c; return res; },
    json(b: unknown) { out.body = b; return res; },
    setHeader() { return res; },
  } as unknown as Response;
  return { res, out };
}

(async () => {
  /* ── 2/3: relevance and the search states ── */
  await ok('normalize folds final letters, quotes and niqqud', () => {
    assert.equal(normalize('מסעדת ג\'ו בע"מ'), 'מסעדת גו בעמ');
    assert.equal(normalize('שָׁלוֹם'), 'שלומ');
    assert.equal(normalize('Cafe  QA!!'), 'cafe qa');
  });
  await ok('relevance: name + city is a strong match; city counts only half', () => {
    assert.equal(relevance('קייטרינג דוד חיפה', { name: 'קייטרינג דוד', details: 'חיפה, ישראל' }).relevance, 'strong');
    assert.equal(relevance('קייטרינג דוד', { name: 'הקייטרינג של דוד', details: 'תל אביב' }).relevance, 'strong');
    assert.equal(relevance('מאפי', { name: 'מאפייה ברחוב', details: '' }).relevance, 'strong', 'a word still being typed');
    assert.equal(relevance('שרברב דני', { name: 'שרברב יוסי', details: 'חיפה' }).relevance, 'partial');
  });
  await ok('relevance: an invented name against unrelated bakeries is "none"', () => {
    const q = 'מאפיית זרזיר הכחול באר שבע';
    const list = [
      { placeId: 'ChIJ_bakery00001', name: 'מאפיית לחם הבית', details: 'באר שבע' },
      { placeId: 'ChIJ_bakery00002', name: 'מאפיית אבי', details: 'באר שבע, ישראל' },
      { placeId: 'ChIJ_bakery00003', name: 'קונדיטוריה רויאל', details: 'באר שבע' },
    ];
    const ranked = rankSuggestions(q, list);
    assert.ok(ranked.every((r) => r.relevance === 'none'), JSON.stringify(ranked.map((r) => [r.name, r.score])));
    const v = searchView({ query: q, searching: false, error: null, results: ranked });
    assert.equal(v.status, 'results');
    assert.equal(v.noneMatch, true);
    assert.match(v.title, /לא מצאנו עסק בשם הזה/);
  });
  await ok('rankSuggestions puts name matches first, keeps Google order within a tier', () => {
    const ranked = rankSuggestions('קפה נועה', [
      { placeId: 'ChIJ_a0000000001', name: 'מאפה נועם', details: '' },
      { placeId: 'ChIJ_a0000000002', name: 'קפה נועה', details: 'רמת גן' },
      { placeId: 'ChIJ_a0000000003', name: 'בית קפה', details: '' },
    ]);
    assert.deepEqual(ranked.map((r) => r.placeId), ['ChIJ_a0000000002', 'ChIJ_a0000000003', 'ChIJ_a0000000001']);
    assert.equal(ranked[0].relevance, 'strong');
  });
  await ok('searchView: idle, searching, empty (with message), error, results', () => {
    assert.equal(searchView({ query: 'א', searching: false, error: null, results: [] }).status, 'idle');
    assert.equal(searchView({ query: 'קפה', searching: true, error: null, results: null }).status, 'searching');
    const empty = searchView({ query: 'QA בדיקה', searching: false, error: null, results: [] });
    assert.equal(empty.status, 'empty');
    assert.equal(empty.title, 'לא נמצאו עסקים בשם הזה');
    assert.equal(searchView({ query: 'קפה', searching: false, error: 'החיפוש נכשל.', results: null }).status, 'error');
    // A new query starts with results === null: the old results are never shown for it.
    assert.equal(searchView({ query: 'קפה חדש', searching: false, error: null, results: null }).status, 'idle');
    const res = searchView({ query: 'קפה נועה', searching: false, error: null, results: rankSuggestions('קפה נועה', [{ placeId: 'ChIJ_a0000000002', name: 'קפה נועה', details: '' }]) });
    assert.equal(res.noneMatch, false);
    assert.match(res.title, /נמצאו 1 עסקים/);
    assert.ok(NO_RESULT_TIPS.length >= 3);
  });

  /* ── 5/6: input validation ── */
  await ok('queryError: empty / short on submit, too long always', () => {
    assert.equal(queryError('', false), null, 'no nagging while typing');
    assert.equal(queryError('', true), 'הקלידו את שם העסק והעיר.');
    assert.equal(queryError('   ', true), 'הקלידו את שם העסק והעיר.');
    assert.equal(queryError('א', true), 'הקלידו לפחות 2 תווים.');
    assert.equal(queryError('קפה נועה', true), null);
    assert.match(queryError('א'.repeat(MAX_QUERY_LEN + 1), false)!, /עד 100 תווים/);
    assert.equal(queryError('א'.repeat(MAX_QUERY_LEN), true), null);
  });
  await ok('passwordError: empty is "נא להזין סיסמה", short is "לפחות 6 תווים"', () => {
    assert.equal(passwordError(''), 'נא להזין סיסמה');
    assert.equal(passwordError('   '), 'נא להזין סיסמה');
    assert.equal(passwordError('12345'), 'הסיסמה חייבת להכיל לפחות 6 תווים');
    assert.equal(passwordError('123456'), null);
  });
  await ok('server rejects an over-long search text (account and public)', async () => {
    const long = 'א'.repeat(201);
    const a = mockRes();
    await placesAutocomplete({ authEmail: 'qa@example.com', body: { input: long } } as unknown as Request, a.res);
    assert.equal(a.out.status, 400);
    assert.equal((a.out.body as { code: string }).code, 'input_too_long');
    const p = mockRes();
    await publicSearch({ body: { input: long } } as unknown as Request, p.res);
    assert.equal(p.out.status, 400);
  });

  /* ── 1c: connected listing vs picked place ── */
  const picked = [{ id: '11111111-1111-1111-1111-111111111111', name: 'מרפאת שיניים שורש', google_place_id: 'ChIJ_picked00001' }];
  await ok('placeMatch: same place id → match', () => {
    const m = placeMatch({ title: 'מרפאת שיניים שורש', placeId: 'ChIJ_picked00001' }, picked);
    assert.equal(m.status, 'match');
    assert.equal(m.selected?.id, picked[0].id);
  });
  await ok('placeMatch: different place id → mismatch (even with the same name)', () => {
    const m = placeMatch({ title: 'מרפאת שיניים שורש', placeId: 'ChIJ_other000001' }, picked);
    assert.equal(m.status, 'mismatch');
    assert.equal(m.connected.placeId, 'ChIJ_other000001');
    assert.equal(m.selected?.name, 'מרפאת שיניים שורש');
  });
  await ok('placeMatch: no place id from Google → compare names; nothing picked → unknown', () => {
    assert.equal(placeMatch({ title: 'מרפאת  שיניים, שורש', placeId: null }, picked).status, 'match');
    assert.equal(placeMatch({ title: 'מספרת רחל', placeId: null }, picked).status, 'mismatch');
    assert.equal(placeMatch({ title: '', placeId: null }, picked).status, 'unknown');
    assert.equal(placeMatch({ title: 'x', placeId: 'ChIJ_other000001' }, []).status, 'unknown');
    const two = [...picked, { id: '22222222-2222-2222-2222-222222222222', name: 'סניף 2', google_place_id: 'ChIJ_branch00002' }];
    assert.equal(placeMatch({ title: 'סניף 2', placeId: 'ChIJ_branch00002' }, two).status, 'match');
  });

  /* ── 1d: selections per account ── */
  await ok('selection guard: distinct places per account per day; repeats never count', () => {
    resetSelections();
    const day = new Date('2026-11-24T10:00:00Z');
    for (let i = 0; i < MAX_DISTINCT_PICKS_PER_DAY; i++) assert.equal(takeSelection('a@x.co', `ChIJ_place0000${i}`, day), 'ok');
    assert.equal(takeSelection('a@x.co', 'ChIJ_place00000', day), 'ok', 'the same place again is fine');
    assert.equal(takeSelection('A@X.co', 'ChIJ_new000000001', day), 'limit', 'case-insensitive account');
    assert.equal(takeSelection('b@x.co', 'ChIJ_new000000001', day), 'ok', 'other accounts are not affected');
    assert.equal(takeSelection('a@x.co', 'ChIJ_new000000001', new Date('2026-11-25T00:00:01Z')), 'ok', 'resets the next day');
    resetSelections();
  });

  /* ── 4: audit sanity for a sparse listing ── */
  const sparsePlace = { id: 'ChIJ_sparse000001', displayName: { text: 'מאפיית בדיקה QA' }, formattedAddress: 'באר שבע' };
  await ok('near-empty listing: 5/100 is right (only "operational" scores), and it is explained', () => {
    const a = buildAudit(sparsePlace, null);
    assert.equal(a.score, 5, 'no rating, reviews, photos, phone, website, hours or category');
    assert.equal(a.benchmark, null);
    const withCategory = buildAudit({ ...sparsePlace, primaryType: 'bakery', primaryTypeDisplayName: { text: 'מאפייה' } }, null);
    assert.equal(withCategory.score, 10);
    const full = buildAudit({ ...sparsePlace, nationalPhoneNumber: '08-1234567', regularOpeningHours: {}, websiteUri: 'https://x.co.il', primaryType: 'bakery' }, null);
    assert.equal(full.score, 5 + 8 + 7 + 10 + 5, 'every basic detail adds exactly its weight');
    const ex = sparseExplainer(a as unknown as Audit);
    assert.ok(ex, 'a sparse card says why its score is low');
    assert.ok(ex!.gains.some((g) => g.key === 'phone' && g.points === 8));
    assert.equal(ex!.gains[0].key, 'reviews', 'biggest gain first');
    assert.equal(sparseExplainer(buildAudit({ ...full, rating: 4.8, userRatingCount: 80, photos: new Array(10).fill({}) }, null) as unknown as Audit), null);
    assert.match(benchmarkNote(a as unknown as Audit), /אין קטגוריה ראשית/);
    assert.match(benchmarkNote(withCategory as unknown as Audit), /לא מצאנו מספיק עסקים דומים/);
  });
  await ok('client weights mirror the server score', () => {
    assert.equal(Object.values(CLIENT_WEIGHT).reduce((x, y) => x + y, 0), 100);
  });
  await ok('no "soon" promise reaches the customer view for what is live; soon items carry no label', () => {
    const a = buildAudit(sparsePlace, null);
    assert.equal(a.items.find((i) => i.key === 'rating')!.weDoAvailability, 'now');
    assert.equal(a.items.find((i) => i.key === 'reviews')!.weDoAvailability, 'now');
    assert.ok(!a.items.some((i) => /iCount|SUMIT/.test(i.youDo + i.weDo)), 'no invoice integration promise');
    const recs = buildRecommendations(a as unknown as Audit);
    assert.ok(recs.every((r) => r.weDoLabel === null || r.weDoLabel === 'נטפל בזה בשבילכם אחרי ההרשמה'));
    assert.ok(!JSON.stringify(recs).includes('בקרוב'));
  });
  await ok('benchmark names the leaders (top 3 by reviews, only with a name), never self', () => {
    const comps = [
      { id: 'me', displayName: { text: 'אני' }, rating: 5, userRatingCount: 9999 },
      { id: 'c1', displayName: { text: 'מאפיית אבי' }, rating: 4.61, userRatingCount: 300 },
      { id: 'c2', displayName: { text: 'לחם הבית' }, rating: 4.4, userRatingCount: 120 },
      { id: 'c3', rating: 4.9, userRatingCount: 500 },
      { id: 'c4', displayName: { text: 'קונדיטוריה רויאל' }, rating: 4.2, userRatingCount: 80 },
      { id: 'c5', displayName: { text: 'פת שחרית' }, rating: 4.0, userRatingCount: 10 },
    ];
    const b = buildBenchmark('me', comps)!;
    assert.equal(b.count, 5);
    assert.equal(b.leaders.length, LEADERS_SHOWN);
    assert.deepEqual(b.leaders.map((l) => l.name), ['מאפיית אבי', 'לחם הבית', 'קונדיטוריה רויאל']);
    assert.equal(b.leaders[0].rating, 4.6);
    assert.equal(b.leaders[0].reviews, 300);
    assert.ok(!b.leaders.some((l) => l.name === 'אני'));
    // The audit passes the names through unchanged.
    assert.deepEqual(buildAudit(sparsePlace, b).benchmark!.leaders, b.leaders);
  });

  /* ── 7: static first paint, and customer pages keep an empty root ── */
  await ok('index.html paints a branded loading screen; customer pages strip it', () => {
    const html = readFileSync(join(__dirname, '..', 'client', 'index.html'), 'utf8');
    assert.match(html, /<div id="root"><!--boot-->[\s\S]*Pagey[\s\S]*טוענים את העמוד…[\s\S]*<!--\/boot--><\/div>/);
    assert.match(html, /fonts\.googleapis\.com[^>]*media="print"/, 'the font CSS does not block the first paint');
    const stripped = stripBootShell(html);
    assert.ok(stripped.includes('<div id="root"></div>'));
    assert.ok(!stripped.includes('טוענים את העמוד'));
    assert.ok(injectSeoBody(html, '<main>תוכן</main>').includes('<div id="root"><main>תוכן</main></div>'));
    assert.equal(injectSeoBody('<div id="root"></div>', '<p>x</p>'), '<div id="root"><p>x</p></div>', 'old empty root still works');
  });
  await ok('legal pages are in the main bundle; login is preloaded on intent', () => {
    const app = readFileSync(join(__dirname, '..', 'client', 'src', 'App.tsx'), 'utf8');
    for (const p of ['Privacy', 'Terms', 'Accessibility']) {
      assert.match(app, new RegExp(`^import ${p}\\s+from './pages/legal/${p}';`, 'm'), `${p} eager`);
      assert.doesNotMatch(app, new RegExp(`const ${p}\\s*=\\s*lazy`), `${p} not lazy`);
    }
    assert.match(app, /const Login\s*=\s*lazy\(loadLogin\)/);
    assert.match(app, /<PreloadLogin \/>/);
  });

  console.log(`\n${n} qa-onboarding checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
