// The public audit endpoint: same score as the dashboard audit, plus AI readiness and category line. Fake Places, no network.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
process.env.GOOGLE_PLACES_API_KEY = 'fake-key';
process.env.PUBLIC_AUDIT_DAILY_CAP = '50';
import assert from 'assert';
import { publicAudit } from '../src/controllers/publicAudit.controller';
import { auditPlace } from '../src/services/places.service';

const PLACE = {
  id: 'ChIJselfselfself', displayName: { text: 'שרברב דני' }, rating: 4.4, userRatingCount: 40, nationalPhoneNumber: '03-1234567',
  websiteUri: 'http://127.0.0.1/', primaryType: 'plumber', primaryTypeDisplayName: { text: 'אינסטלטור' },
  regularOpeningHours: {}, location: { latitude: 32, longitude: 34.8 }, photos: [],
};
const peers = (type: string, label: string) => [200, 150, 100, 50].map((n, i) => ({ id: `p${i}`, rating: 4.6, userRatingCount: n, primaryType: type, primaryTypeDisplayName: { text: label } }));
let nearbyBodies: string[] = [];
let category = ['general_contractor', 'קבלן שיפוצים'];
global.fetch = (async (url: any, init?: any) => {
  const u = String(url);
  if (u.includes(':searchNearby')) {
    nearbyBodies.push(String(init.body));
    return new Response(JSON.stringify({ places: peers(category[0], category[1]) }), { status: 200 });
  }
  return new Response(JSON.stringify(PLACE), { status: 200 });
}) as typeof fetch;

const res = () => { const r: any = { code: 200, body: null, status(c: number) { r.code = c; return r; }, json(b: unknown) { r.body = b; return r; }, setHeader() { return r; } }; return r; };

(async () => {
  const r = res();
  await publicAudit({ params: { placeId: 'ChIJselfselfself' } } as any, r);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.aiReadiness, { status: 'unreachable', host: '127.0.0.1', checks: [] }, 'a blocked/unreachable website never fails the audit and no request leaves the server');
  assert.equal(r.body.categoryCheck.status, 'different');
  assert.ok(r.body.categoryCheck.line.includes('קבלן שיפוצים') && r.body.categoryCheck.line.includes('אינסטלטור'));
  assert.equal(nearbyBodies.length, 2, 'benchmark search + category search');
  assert.ok(nearbyBodies.some(b => b.includes('includedPrimaryTypes')) && nearbyBodies.some(b => b.includes('"includedTypes"')));
  const dash = await auditPlace('ChIJselfselfself');
  assert.equal(r.body.audit.score, dash.score, 'public score equals the dashboard score');

  // Same category as the leaders.
  category = ['plumber', 'אינסטלטור'];
  const r2 = res(); await publicAudit({ params: { placeId: 'ChIJselfselfself' } } as any, r2);
  assert.equal(r2.body.categoryCheck.status, 'same');

  // Switches.
  process.env.AUDIT_CATEGORY_CHECK_ENABLED = 'false'; process.env.AUDIT_AI_READINESS_ENABLED = 'false';
  nearbyBodies = [];
  const r3 = res(); await publicAudit({ params: { placeId: 'ChIJselfselfself' } } as any, r3);
  assert.equal(r3.body.categoryCheck, null); assert.equal(r3.body.aiReadiness, null);
  assert.equal(nearbyBodies.length, 1, 'category call removed when switched off');
  assert.equal(r3.body.audit.score, r.body.audit.score, 'switches never change the score');
  console.log('public audit full checks passed');
})().catch(e => { console.error(e); process.exit(1); });
