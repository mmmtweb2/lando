// Run: npx ts-node --transpile-only scripts/test-seo-businesses.ts
// Stage 6.1 — save/list/remove businesses, against an in-memory fake of the supabase client
// plus a mocked Places fetch. No network, no DB.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
process.env.GOOGLE_PLACES_API_KEY = 'TEST_KEY';

import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';

type Row = Record<string, any>;
const table: Row[] = [];
let seq = 0;

function builder(op: 'select' | 'insert' | 'delete', payload?: Row) {
  const filters: Array<[string, unknown]> = [];
  let single = false;
  let orderKey: string | null = null;
  let returning = op === 'select';
  const run = () => {
    const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
    if (op === 'insert') {
      if (table.some(r => r.owner_email === payload!.owner_email && r.google_place_id === payload!.google_place_id))
        return { data: null, error: { message: 'duplicate key' } };
      const row = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, landing_page_id: null, created_at: new Date(seq * 1000).toISOString(), ...payload };
      table.push(row);
      return { data: single ? row : [row], error: null };
    }
    if (op === 'delete') {
      const gone = table.filter(match);
      for (const g of gone) table.splice(table.indexOf(g), 1);
      return { data: returning ? gone : null, error: null };
    }
    let rows = table.filter(match);
    if (orderKey) rows = rows.sort((a, b) => String(a[orderKey!]).localeCompare(String(b[orderKey!])));
    return { data: rows, error: null };
  };
  const q: any = {
    select() { returning = true; return q; },
    eq(k: string, v: unknown) { filters.push([k, v]); return q; },
    order(k: string) { orderKey = k; return q; },
    single() { single = true; return q; },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
  };
  return q;
}
(supabase as any).from = (_t: string) => ({
  select: () => builder('select'),
  insert: (p: Row) => builder('insert', p),
  delete: () => builder('delete'),
});

import { saveBusiness, getBusinesses, deleteBusiness } from '../src/controllers/seo.controller';

function res() {
  const r: any = { code: 200, body: undefined };
  r.status = (c: number) => { r.code = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
}
const req = (o: any) => ({ authEmail: 'a@b.co', params: {}, body: {}, ...o }) as any;
const place = (id: string, name: string) => ({ id, displayName: { text: name }, websiteUri: 'https://' + name.replace(/\W/g, '') + '.co.il' });
const mockPlace = (p: any) => { globalThis.fetch = (async () => new Response(JSON.stringify(p), { status: 200 })) as typeof fetch; };

(async () => {
  let r = res(); await getBusinesses(req({}), r);
  assert.deepEqual(r.body.businesses, []); assert.equal(r.body.max, 3);

  mockPlace(place('ChIJ_firstplace01', 'first'));
  r = res(); await saveBusiness(req({ body: { placeId: 'ChIJ_firstplace01', name: 'EVIL' } }), r);
  assert.equal(r.code, 201);
  assert.equal(r.body.business.name, 'first', 'name must come from Google, not from the client body');
  assert.equal(r.body.business.website_url, null, 'Places content other than place_id/name is not stored');
  const firstId = r.body.business.id;

  r = res(); await saveBusiness(req({ body: { placeId: 'ChIJ_firstplace01' } }), r);
  assert.equal(r.code, 200); assert.equal(table.length, 1, 'idempotent');

  for (const [i, n] of [[2, 'second'], [3, 'third']] as const) {
    mockPlace(place(`ChIJ_place_number${i}`, n)); r = res();
    await saveBusiness(req({ body: { placeId: `ChIJ_place_number${i}` } }), r); assert.equal(r.code, 201);
  }
  mockPlace(place('ChIJ_place_number4', 'fourth'));
  r = res(); await saveBusiness(req({ body: { placeId: 'ChIJ_place_number4' } }), r);
  assert.equal(r.code, 409); assert.equal(r.body.code, 'business_limit');

  r = res(); await saveBusiness(req({ authEmail: 'other@b.co', body: { placeId: 'ChIJ_firstplace01' } }), r);
  assert.equal(r.code, 201, 'another account can save the same place');

  r = res(); await getBusinesses(req({}), r);
  assert.equal(r.body.businesses.length, 3);
  r = res(); await getBusinesses(req({ authEmail: 'other@b.co' }), r);
  assert.equal(r.body.businesses.length, 1);

  r = res(); await saveBusiness(req({ body: { placeId: '../x' } }), r); assert.equal(r.code, 400);

  r = res(); await deleteBusiness(req({ params: { id: firstId }, authEmail: 'other@b.co' }), r);
  assert.equal(r.code, 404, "cannot delete someone else business");
  r = res(); await deleteBusiness(req({ params: { id: 'not-a-uuid' } }), r); assert.equal(r.code, 400);
  r = res(); await deleteBusiness(req({ params: { id: firstId } }), r); assert.equal(r.code, 200);
  r = res(); await getBusinesses(req({}), r); assert.equal(r.body.businesses.length, 2);

  console.log('business checks passed');
})().catch(e => { console.error(e); process.exit(1); });
