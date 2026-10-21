// Run: npx ts-node --transpile-only scripts/test-places.ts
// Pure-logic + mocked-fetch checks for Stage 5.5.2. No network, no key, no DB.
import assert from 'node:assert/strict';
import { buildAudit } from '../src/services/placesAudit';
import {
  PlacesError, autocompleteBusinesses, auditPlace, isValidPlaceId, placesConfigured,
} from '../src/services/places.service';

let n = 0;
const ok = (name: string, fn: () => void | Promise<void>) =>
  Promise.resolve(fn()).then(() => { n++; console.log('ok  ', name); });

const strong = { id: 'ChIJ_strongplace1', displayName: { text: 'עסק חזק' }, rating: 4.8, userRatingCount: 120,
  nationalPhoneNumber: '03-1234567', websiteUri: 'https://x.co.il', businessStatus: 'OPERATIONAL',
  photos: new Array(10).fill({}) };
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
    assert.equal(a.hasPhone, false);
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
    assert.equal(buildAudit({ ...strong, businessStatus: 'CLOSED_PERMANENTLY' }).operational, false);
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
  await ok('audit fetch uses GET + field mask, builds audit', async () => {
    mock(200, strong);
    const a = await auditPlace('ChIJ_strongplace1');
    assert.equal(a.score, 100);
    const c = calls[calls.length - 1];
    assert.ok(c.url.startsWith('https://places.googleapis.com/v1/places/ChIJ_strongplace1'));
    assert.ok((c.init.headers as Record<string, string>)['X-Goog-FieldMask'].includes('userRatingCount'));
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
