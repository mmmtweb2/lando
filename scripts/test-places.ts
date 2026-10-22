// Run: npx ts-node --transpile-only scripts/test-places.ts
// Pure-logic + mocked-fetch checks for Stage 5.5.2. No network, no key, no DB.
import assert from 'node:assert/strict';
import { buildAudit, buildBenchmark } from '../src/services/placesAudit';
import {
  PlacesError, autocompleteBusinesses, auditPlace, isValidPlaceId, placesConfigured,
} from '../src/services/places.service';

let n = 0;
const ok = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve(fn()).then(() => { n++; console.log('ok  ', name); });

const strong = { id: 'ChIJ_strongplace1', displayName: { text: 'עסק חזק' }, rating: 4.8, userRatingCount: 120,
  nationalPhoneNumber: '03-1234567', websiteUri: 'https://x.co.il', businessStatus: 'OPERATIONAL',
  primaryType: 'caterer', primaryTypeDisplayName: { text: 'קייטרינג' }, regularOpeningHours: { periods: [] },
  location: { latitude: 32.08, longitude: 34.78 }, photos: new Array(10).fill({}) };
const weak = { id: 'ChIJ_weakplace12', displayName: { text: 'עסק חלש' }, rating: 3.6, userRatingCount: 4, photos: [{}, {}] };

(async () => {
  await ok('strong business scores high, photos capped', () => {
    const a = buildAudit(strong);
    assert.equal(a.score, 100);
    assert.equal(a.photosCapped, true);
    assert.equal(a.items.find(i => i.key === 'photos')!.value, '10+');
    assert.equal(a.reviewsMissing, 0);
  });
  await ok('weak business: low score, concrete review gap, tips present', () => {
    const a = buildAudit(weak);
    assert.ok(a.score < 30, `score ${a.score}`);
    assert.equal(a.reviewsMissing, 46);
    assert.equal(a.items.find(i => i.key === 'phone')!.level, 'weak');
    assert.ok(a.items.filter(i => i.level === 'weak').every(i => i.tip.length > 0));
    assert.equal(a.photosCapped, false);
  });
  await ok('no rating is handled', () => {
    const a = buildAudit({ id: 'ChIJ_norating12' });
    assert.equal(a.rating, null);
    assert.equal(a.items[0].value, 'אין דירוג');
    assert.ok(a.score >= 0 && a.score <= 100);
  });
  await ok('closed business flagged', () => {
    assert.equal(buildAudit({ ...strong, businessStatus: 'CLOSED_PERMANENTLY' }).items.find(i => i.key === 'status')!.level, 'weak');
  });
  await ok('isValidPlaceId blocks path tricks', () => {
    assert.equal(isValidPlaceId('ChIJN1t_tDeuEmsRUsoyG83frY4'), true);
    for (const bad of ['../etc/passwd', 'a/b', 'short', '', 'x?y=1', 'a b c d e f g h i j', undefined, 5])
      assert.equal(isValidPlaceId(bad as unknown), false, String(bad));
  });

  // ── mocked network ──
  const realFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const mock = (status: number, body: unknown) => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  };

  delete process.env.GOOGLE_PLACES_API_KEY;
  await ok('no key → not configured, no network call', async () => {
    assert.equal(placesConfigured(), false);
    await assert.rejects(autocompleteBusinesses('קייטרינג'), (e: unknown) => e instanceof PlacesError && e.code === 'not_configured');
    assert.equal(calls.length, 0);
  });

  process.env.GOOGLE_PLACES_API_KEY = 'TEST_KEY_123';
  await ok('autocomplete sends key+mask, he/IL, parses suggestions', async () => {
    mock(200, { suggestions: [
      { placePrediction: { placeId: 'ChIJ_aaaaaaaaaa', structuredFormat: { mainText: { text: 'קייטרינג דוד' }, secondaryText: { text: 'תל אביב' } } } },
      { queryPrediction: { text: { text: 'ignored' } } },
    ] });
    const r = await autocompleteBusinesses('  קייטרינג דוד ', 'sess_token_12345');
    assert.deepEqual(r, [{ placeId: 'ChIJ_aaaaaaaaaa', name: 'קייטרינג דוד', details: 'תל אביב' }]);
    const c = calls[calls.length - 1];
    const h = c.init.headers as Record<string, string>;
    assert.equal(h['X-Goog-Api-Key'], 'TEST_KEY_123');
    assert.ok(h['X-Goog-FieldMask'].includes('placePrediction.placeId'));
    const b = JSON.parse(String(c.init.body));
    assert.equal(b.languageCode, 'he'); assert.equal(b.regionCode, 'IL'); assert.equal(b.input, 'קייטרינג דוד');
    assert.equal(b.sessionToken, 'sess_token_12345');
  });
  await ok('short input makes no call', async () => {
    const before = calls.length;
    assert.deepEqual(await autocompleteBusinesses('א'), []);
    assert.equal(calls.length, before);
  });
  const comps = (rs: Array<[number, number]>) => rs.map(([r, c], i) => ({ id: `c${i}`, rating: r, userRatingCount: c }));
  const mockRoutes = (place: unknown, nearby: { status: number; body: unknown }) => {
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const isNearby = String(url).endsWith('places:searchNearby');
      const r = isNearby ? nearby : { status: 200, body: place };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }) as typeof fetch;
  };

  await ok('audit: GET place with mask, then searchNearby for the benchmark, relative score', async () => {
    const before = calls.length;
    mockRoutes(strong, { status: 200, body: { places: comps([[4.5, 80], [4.4, 120], [4.7, 200], [4.6, 60], [4.3, 300]]) } });
    const a = await auditPlace('ChIJ_strongplace1');
    assert.equal(calls.length - before, 2);
    const get = calls[before]; const nb = calls[before + 1];
    assert.ok(get.url.startsWith('https://places.googleapis.com/v1/places/ChIJ_strongplace1'));
    assert.ok((get.init.headers as Record<string, string>)['X-Goog-FieldMask'].includes('userRatingCount'));
    const body = JSON.parse(String(nb.init.body));
    assert.deepEqual(body.includedPrimaryTypes, ['caterer']);
    assert.equal(body.locationRestriction.circle.radius, 5000);
    assert.equal((nb.init.headers as Record<string, string>)['X-Goog-FieldMask'], 'places.id,places.rating,places.userRatingCount');
    assert.equal(a.benchmark!.count, 5);
    assert.equal(a.benchmark!.medianReviews, 120);
    assert.equal(a.score, 100);
  });
  await ok('benchmark failure falls back to fixed targets (no throw)', async () => {
    mockRoutes(strong, { status: 500, body: {} });
    const a = await auditPlace('ChIJ_strongplace1');
    assert.equal(a.benchmark, null);
    assert.equal(a.score, 100);
  });
  await ok('buildBenchmark: excludes self, needs >=3 usable competitors, medians', () => {
    assert.equal(buildBenchmark('me', comps([[4.5, 10], [4.5, 20]])), null);
    assert.equal(buildBenchmark('me', [{ id: 'me', rating: 5, userRatingCount: 999 }, ...comps([[4.0, 10], [4.2, 30], [4.4, 50]])])!.count, 3);
    const b = buildBenchmark('me', comps([[4.0, 10], [4.2, 30], [4.4, 50], [4.9, 70]]))!;
    assert.equal(b.medianReviews, 40);
    assert.equal(b.ratingTarget, 4.3); // median 4.3 inside the 4.3–4.8 band
    assert.equal(buildBenchmark('me', comps([[3.5, 5], [3.6, 5], [3.7, 5]]))!.reviewsTarget, 20); // floor
  });
  await ok('score is RELATIVE: same business scores lower in a tougher market', () => {
    const me = { ...strong, rating: 4.6, userRatingCount: 60 };
    const easy = buildBenchmark('me', comps([[4.4, 30], [4.4, 40], [4.4, 50]]));
    const hard = buildBenchmark('me', comps([[4.7, 900], [4.8, 1500], [4.7, 2500]]));
    const sEasy = buildAudit(me, easy).score, sHard = buildAudit(me, hard).score;
    assert.ok(sEasy > sHard, `${sEasy} vs ${sHard}`);
    assert.ok(buildAudit(me, hard).reviewsMissing > 800);
    assert.ok(buildAudit(me, hard).items.find(i => i.key === 'reviews')!.tip.includes('חציון'));
  });
  await ok('every item says who does what', () => {
    const a = buildAudit({ id: 'ChIJ_empty123456' });
    assert.equal(a.items.length, 8);
    for (const i of a.items) {
      assert.ok(i.weDo.length > 0 && (i.weDoAvailability === 'now' || i.weDoAvailability === 'soon'), i.key);
      if (i.level === 'weak') assert.ok(i.youDo.length > 0, `${i.key} weak but no youDo`);
    }
    assert.equal(buildAudit(strong).items.every(i => i.youDo === '' || i.key === 'photos'), true);
  });
  await ok('upstream errors map to PlacesError without leaking the key', async () => {
    for (const [status, code] of [[404, 'not_found'], [400, 'bad_request'], [403, 'upstream'], [500, 'upstream']] as const) {
      mock(status, { error: { message: 'key TEST_KEY_123 invalid' } });
      await assert.rejects(auditPlace('ChIJ_strongplace1'), (e: unknown) =>
        e instanceof PlacesError && e.code === code && !e.message.includes('TEST_KEY_123'));
    }
  });
  await ok('invalid place id rejected before any call', async () => {
    const before = calls.length;
    await assert.rejects(auditPlace('../../x'), (e: unknown) => e instanceof PlacesError && e.code === 'bad_request');
    assert.equal(calls.length, before);
  });

  globalThis.fetch = realFetch;
  console.log(`\n${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
