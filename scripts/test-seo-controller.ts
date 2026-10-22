// Run: npx ts-node --transpile-only scripts/test-seo-controller.ts
import assert from 'node:assert/strict';
import { placeAudit, placesAutocomplete } from '../src/controllers/seo.controller';

function res() {
  const r: any = { code: 200, body: undefined };
  r.status = (c: number) => { r.code = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
}
const req = (o: any) => ({ authEmail: 'a@b.co', params: {}, body: {}, ...o }) as any;

(async () => {
  delete process.env.GOOGLE_PLACES_API_KEY;
  let r = res(); await placesAutocomplete(req({ body: { input: 'abc' } }), r);
  assert.equal(r.code, 503); assert.equal(r.body.code, 'places_not_configured');

  r = res(); await placesAutocomplete(req({ body: {} }), r);
  assert.equal(r.code, 400);

  r = res(); await placeAudit(req({ params: { placeId: '../x' } }), r);
  assert.equal(r.code, 400);

  r = res(); await placeAudit(req({ params: { placeId: 'ChIJ_validplace1' } }), r);
  assert.equal(r.code, 503);

  // daily cap: 200 allowed, 201st blocked (key set, fetch mocked so nothing leaves the box)
  process.env.GOOGLE_PLACES_API_KEY = 'K';
  globalThis.fetch = (async () => new Response(JSON.stringify({ suggestions: [] }), { status: 200 })) as typeof fetch;
  let last = 0;
  for (let i = 0; i < 201; i++) { r = res(); await placesAutocomplete(req({ authEmail: 'cap@x.co', body: { input: 'קייטרינג' } }), r); last = r.code; }
  assert.equal(last, 429);
  r = res(); await placesAutocomplete(req({ authEmail: 'other@x.co', body: { input: 'קייטרינג' } }), r);
  assert.equal(r.code, 200); // another account unaffected
  console.log('controller checks passed');
})().catch(e => { console.error(e); process.exit(1); });
