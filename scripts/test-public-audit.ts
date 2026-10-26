// Run: npx ts-node --transpile-only scripts/test-public-audit.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'fake';
process.env.GOOGLE_PLACES_API_KEY = 'K';
delete process.env.PUBLIC_AUDIT_DAILY_CAP;
delete process.env.CONCIERGE_WHATSAPP;
import assert from 'node:assert/strict';
import app from '../src/app';
import { supabase } from '../src/config/supabase';
import { adminAuditLeads, publicConfig, publicLead, conciergeNumber } from '../src/controllers/publicAudit.controller';
import { placeAudit } from '../src/controllers/seo.controller';
import { CONSENT_TEXT, normalizeIlMobile, validateLead, cleanText } from '../src/services/auditLeads.service';
import { resetPublicAuditCounters, takeAudit, usageToday } from '../src/services/publicAuditGuard';
import { isValidPlaceId } from '../src/services/places.service';

const PLACE = 'ChIJ_test_place_00001';
const realFetch = globalThis.fetch;
let placesCalls = 0;
(globalThis as any).fetch = async (url: any, init?: any) => {
  const u = String(url);
  if (!u.startsWith('https://places.googleapis.com')) return realFetch(url, init);
  placesCalls += 1;
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  if (u.endsWith('/places:autocomplete')) {
    return json({ suggestions: [{ placePrediction: { placeId: PLACE, structuredFormat: { mainText: { text: 'שרברב דני' }, secondaryText: { text: 'חיפה' } } } }] });
  }
  if (u.endsWith('/places:searchNearby')) {
    return json({ places: [
      { id: 'c1', rating: 4.9, userRatingCount: 300 }, { id: 'c2', rating: 4.8, userRatingCount: 200 },
      { id: 'c3', rating: 4.7, userRatingCount: 150 }, { id: 'c4', rating: 4.2, userRatingCount: 40 },
    ] });
  }
  return json({
    id: PLACE, displayName: { text: 'שרברב דני' }, formattedAddress: 'חיפה', rating: 4.4, userRatingCount: 37,
    primaryType: 'plumber', location: { latitude: 32.8, longitude: 34.99 }, googleMapsUri: 'https://maps.google.com/?cid=1',
    photos: [{}, {}, {}], websiteUri: 'https://x.co.il', nationalPhoneNumber: '04-1234567', businessStatus: 'OPERATIONAL',
  });
};

// ── fake DB for audit_leads ──
type Row = Record<string, any>;
const db: { audit_leads: Row[] } = { audit_leads: [] };
let missing = false;
(supabase as any).from = (table: string) => {
  const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {};
  const run = (): any => {
    if (missing) return { data: null, error: { code: '42P01', message: 'relation "audit_leads" does not exist' } };
    if (op === 'insert') { db.audit_leads.push({ id: `l${db.audit_leads.length + 1}`, created_at: new Date().toISOString(), ...patch }); return { data: null, error: null }; }
    return { data: db.audit_leads.filter(r => f.every(fn => fn(r))), error: null };
  };
  const q: any = {
    select: () => q, insert: (p: Row) => { op = 'insert'; patch = p; return q; },
    eq: (k: string, v: unknown) => { f.push(r => r[k] === v); return q; },
    gte: (k: string, v: string) => { f.push(r => r[k] >= v); return q; },
    order: () => q, limit: () => q,
    then: (ok: any) => ok(run()),
  };
  return q;
};
function res() {
  const r: any = { code: 200, body: undefined, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.code = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k.toLowerCase()] = v; }; return r;
}

(async () => {
  // ── pure validation ──
  for (const [raw, want] of [
    ['0501234567', '0501234567'], ['050-123-4567', '0501234567'], ['+972 50 123 4567', '0501234567'],
    ['972501234567', '0501234567'], ['(052)1234567', '0521234567'],
    ['041234567', null], ['0401234567', null], ['050123456', null], ['05012345678', null], ['abc', null], [123, null], ['', null],
  ] as Array<[unknown, string | null]>) assert.equal(normalizeIlMobile(raw), want, String(raw));
  assert.equal(cleanText('  דני   כהן ', 2, 60), 'דני כהן');
  assert.equal(cleanText('<b>x</b>', 1, 60), null); assert.equal(cleanText('a\u0000b', 1, 60), null); assert.equal(cleanText('א', 2, 60), null);
  const good = { name: 'דני', phone: '0501234567', placeId: PLACE, consent: true, score: 62, businessName: 'שרברב דני', utm_source: 'fb' };
  assert.equal(validateLead({ ...good, consent: false }, isValidPlaceId).ok, false);
  assert.equal(validateLead({ ...good, consent: 'true' }, isValidPlaceId).ok, false, 'consent must be the boolean true');
  assert.equal(validateLead({ ...good, consent: undefined }, isValidPlaceId).ok, false);
  assert.equal(validateLead({ ...good, phone: '12345' }, isValidPlaceId).ok, false);
  assert.equal(validateLead({ ...good, placeId: '../etc' }, isValidPlaceId).ok, false);
  const v = validateLead({ ...good, score: 1000, utm_source: '<script>' }, isValidPlaceId);
  assert.ok(v.ok && v.value.score === null && v.value.utmSource === null, 'out-of-range score / hostile utm are dropped');

  // ── config + concierge ──
  let r = res(); publicConfig({} as any, r);
  assert.deepEqual(r.body, { auditEnabled: false, concierge: null, consentText: CONSENT_TEXT });
  process.env.CONCIERGE_WHATSAPP = '+972-50-123-4567'; assert.equal(conciergeNumber(), '972501234567');
  process.env.CONCIERGE_WHATSAPP = '12'; assert.equal(conciergeNumber(), null);
  process.env.CONCIERGE_WHATSAPP = 'tel:<x>'; assert.equal(conciergeNumber(), null);
  delete process.env.CONCIERGE_WHATSAPP;

  // ── HTTP: off by default, nothing leaves the box ──
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const get = (p: string) => realFetch(base + p);
  const post = (p: string, body: unknown) => realFetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  let h = await get(`/api/public/audit/${PLACE}`);
  assert.equal(h.status, 503); assert.equal((await h.json()).code, 'public_audit_disabled');
  h = await post('/api/public/audit/search', { input: 'שרברב' });
  assert.equal(h.status, 503);
  assert.equal(placesCalls, 0, 'disabled -> Google is never called');
  h = await get('/api/public/config'); assert.equal((await h.json()).auditEnabled, false);

  // ── global daily cap: 2 audits, the 3rd is a friendly 429 and the rest of the site keeps working ──
  process.env.PUBLIC_AUDIT_DAILY_CAP = '2';
  assert.equal((await get(`/api/public/audit/${PLACE}`)).status, 200);
  h = await get(`/api/public/audit/${PLACE}`); assert.equal(h.status, 200);
  const publicBody = await h.json();
  h = await get(`/api/public/audit/${PLACE}`);
  assert.equal(h.status, 429); const capBody = await h.json();
  assert.equal(capBody.error, 'המערכת עמוסה כרגע, נסו שוב מחר.'); assert.equal(capBody.code, 'daily_cap');
  assert.equal((await get('/api/public/config')).status, 200, 'page/config still load at the cap');
  assert.equal(usageToday().audit, 2);

  // ── same score as the dashboard for the same place_id ──
  const dash = res(); await placeAudit({ authEmail: 'dash@x.co', params: { placeId: PLACE } } as any, dash);
  assert.deepEqual(publicBody.audit, dash.body.audit, 'public audit === dashboard audit');
  assert.ok(typeof publicBody.audit.score === 'number');

  // ── per-IP hourly limit: 10 audits, the 11th is a 429 in Hebrew ──
  process.env.PUBLIC_AUDIT_DAILY_CAP = '1000'; resetPublicAuditCounters();
  // 4 audit-route requests were used above (1 disabled, 3 at the cap test) -> 6 more succeed
  for (let i = 0; i < 6; i++) assert.equal((await get(`/api/public/audit/${PLACE}`)).status, 200, `audit ${i}`);
  h = await get(`/api/public/audit/${PLACE}`);
  assert.equal(h.status, 429); assert.match((await h.json()).error, /מגבלת הבדיקות/);
  assert.ok(h.headers.get('retry-after'));

  // ── search: input shorter than 2 costs nothing; 30/h per IP (3 requests were already counted above: disabled, 'א', numeric) ──
  const callsBefore = placesCalls;
  h = await post('/api/public/audit/search', { input: 'א' }); assert.equal(h.status, 200); assert.deepEqual((await h.json()).suggestions, []);
  assert.equal(placesCalls, callsBefore, 'a 1-character query never reaches Google');
  h = await post('/api/public/audit/search', { input: 12 }); assert.equal(h.status, 400);
  for (let i = 0; i < 27; i++) assert.equal((await post('/api/public/audit/search', { input: 'שרברב' })).status, 200, `search ${i}`);
  h = await post('/api/public/audit/search', { input: 'שרברב' });
  assert.equal(h.status, 429);
  h = await get('/api/public/audit/bad%20id'); assert.ok([400, 429].includes(h.status));
  server.close();

  // ── lead capture (handler called directly: its limiter is covered by the same rateLimit) ──
  const lead = (body: Row, ip = '1.2.3.4') => { const rr = res(); return publicLead({ body, ip } as any, rr).then(() => rr); };
  r = await lead({ ...good, consent: false });
  assert.equal(r.code, 400); assert.equal(r.body.code, 'consent'); assert.equal(db.audit_leads.length, 0, 'no consent -> nothing stored');
  r = await lead({ ...good, consent: 'yes' }); assert.equal(r.code, 400); assert.equal(db.audit_leads.length, 0);
  r = await lead({ ...good, phone: '999' }); assert.equal(r.code, 400); assert.equal(r.body.code, 'phone');
  r = await lead({ ...good, website: 'http://spam' }); assert.equal(r.code, 200); assert.equal(db.audit_leads.length, 0, 'honeypot -> looks fine, stores nothing');
  r = await lead({ ...good, phone: '+972 50-123-4567' });
  assert.equal(r.code, 201); assert.equal(r.body.reviewUrl, `https://search.google.com/local/writereview?placeid=${PLACE}`);
  assert.equal(db.audit_leads.length, 1);
  const row = db.audit_leads[0];
  assert.equal(row.phone, '0501234567'); assert.equal(row.consent_text, CONSENT_TEXT);
  assert.ok(row.consent_at && !Number.isNaN(Date.parse(row.consent_at)));
  assert.equal(row.utm_source, 'fb'); assert.equal(row.score, 62); assert.equal(row.business_name, 'שרברב דני');
  assert.ok(row.ip_hash && row.ip_hash !== '1.2.3.4' && /^[0-9a-f]{32}$/.test(row.ip_hash), 'IP is stored hashed only');
  r = await lead(good); assert.equal(r.code, 200); assert.equal(db.audit_leads.length, 1, 'same phone + place within 24h is one lead');
  r = await lead({ ...good, phone: '0521234567' }); assert.equal(r.code, 201); assert.equal(db.audit_leads.length, 2);
  r = await lead({ ...good, phone: '0521234567', placeId: 'ChIJ_other_place_0002' }); assert.equal(r.code, 201, 'same phone, other business = a new lead');
  process.env.AUDIT_LEAD_DAILY_CAP = '3';
  r = await lead({ ...good, phone: '0531234567' }); assert.equal(r.code, 429, 'daily lead cap is separate from the audit cap');
  delete process.env.AUDIT_LEAD_DAILY_CAP;
  missing = true;
  r = await lead({ ...good, phone: '0541234567' }); assert.equal(r.code, 503); assert.equal(r.body.code, 'leads_unavailable');
  missing = false;

  // ── admin list ──
  r = res(); await adminAuditLeads({} as any, r); assert.equal(r.code, 200); assert.ok(r.body.leads.length >= 2);
  missing = true; r = res(); await adminAuditLeads({} as any, r); assert.deepEqual(r.body, { leads: [], notMigrated: true }); missing = false;

  // ── day rollover resets the counters ──
  resetPublicAuditCounters(); process.env.PUBLIC_AUDIT_DAILY_CAP = '1';
  assert.equal(takeAudit(new Date('2026-10-26T10:00:00Z')), 'ok');
  assert.equal(takeAudit(new Date('2026-10-26T23:00:00Z')), 'cap');
  assert.equal(takeAudit(new Date('2026-10-27T00:00:01Z')), 'ok', 'new UTC day, new budget');

  console.log('public audit checks passed');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
