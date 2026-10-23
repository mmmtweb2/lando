// Run: npx ts-node --transpile-only scripts/test-external-leads.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { TRACK_SCRIPT, trackExternalEvent } from '../src/controllers/seoTrack.controller';
import { getExternalLeads, isExternalEventType, underEventCap } from '../src/services/externalLeads.service';
import { getMyLeads } from '../src/controllers/landing.controller';
import { supabase } from '../src/config/supabase';

const BIZ = '11111111-1111-4111-8111-111111111111';

// ── the snippet, run in a fake browser ──
function runSnippet(attr: string | null, src = 'https://pagey.co.il/w/track.js') {
  const beacons: string[] = [];
  const listeners: Array<(e: any) => void> = [];
  const doc: any = {
    currentScript: { src, getAttribute: (n: string) => (n === 'data-b' ? attr : null) },
    referrer: 'https://google.com/',
    addEventListener: (_t: string, fn: any) => listeners.push(fn),
  };
  const ctx: any = {
    document: doc, URL, encodeURIComponent, Date,
    location: { href: 'https://shop.example.com/contact' },
    navigator: { sendBeacon: (u: string) => { beacons.push(u); return true; } },
  };
  ctx.window = ctx;
  vm.runInNewContext(TRACK_SCRIPT, ctx);
  const a = (href: string, nested = false) => {
    const anchor: any = { tagName: 'A', getAttribute: () => href, parentNode: doc };
    return { target: nested ? { tagName: 'SPAN', parentNode: anchor } : anchor };
  };
  return { beacons, listeners, click: (href: string, nested = false) => listeners.forEach(l => l(a(href, nested))), doc };
}
let s = runSnippet(BIZ);
assert.equal(s.listeners.length, 1);
s.click('tel:+972501234567');
assert.equal(s.beacons.length, 1);
assert.ok(s.beacons[0].startsWith(`https://pagey.co.il/api/seo/track/${BIZ}?t=call&u=`), s.beacons[0]);
assert.ok(s.beacons[0].includes(encodeURIComponent('https://shop.example.com/contact')));
assert.ok(s.beacons[0].includes('&r=' + encodeURIComponent('https://google.com/')));
s.click('https://wa.me/972501234567?text=hi', true);              // click on a child of the link
s.click('https://api.whatsapp.com/send?phone=972501234567');
s.click('mailto:a@b.co');
s.click('https://example.com/about');                            // ordinary link: ignored
s.click('https://evil.com/wa.me/x');                             // lookalike: ignored
// the second WhatsApp link (api.whatsapp.com) is a repeat of the same type within 1.5s -> deduped
assert.deepEqual(s.beacons.map(b => b.match(/t=(\w+)/)![1]), ['call', 'whatsapp', 'email']);
s.click('tel:+972501234567'); s.click('tel:+972501234567');       // double click within 1.5s: counted once
assert.equal(s.beacons.filter(b => b.includes('t=call')).length, 2, 'one more call, not two');
assert.ok(s.beacons.every(b => !b.includes('evil.com') && !b.includes('about')));
assert.equal(runSnippet(null).listeners.length, 0, 'no business id -> inert');
assert.equal(runSnippet('not-a-uuid').listeners.length, 0, 'bad id -> inert');
assert.equal(runSnippet(BIZ, 'not a url').listeners.length, 0, 'bad src -> inert, never throws');

// ── fake DB ──
type Row = Record<string, any>;
const db: Record<string, Row[]> = {
  seo_businesses: [{ id: BIZ, owner_email: 'o@x.co', name: 'שרברב דני' }, { id: 'other-biz', owner_email: 'z@x.co', name: 'x' }],
  user_products: [{ email: 'o@x.co', product: 'seo_autopilot', status: 'active', current_period_end: null }],
  lead_events: [], landing_pages: [], leads: [],
};
let dbError = false;
(supabase as any).from = (table: string) => {
  const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {}; let head = false; let lim = Infinity; let withCount = false;
  const rows = () => db[table].filter(r => f.every(fn => fn(r)));
  const run = (): any => {
    if (dbError && table === 'lead_events') return { data: null, error: { message: 'boom' }, count: null };
    if (op === 'insert') { db[table].push({ id: `e${db[table].length}`, created_at: new Date(2026, 9, db[table].length + 1).toISOString(), ...patch }); return { data: null, error: null }; }
    const m = rows().slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, lim);
    return { data: head ? null : m, error: null, count: withCount ? rows().length : null };
  };
  const q: any = {
    select: (_c?: string, o?: any) => { head = !!o?.head; withCount = !!o?.count; return q; },
    insert: (p: Row) => { op = 'insert'; patch = p; return q; },
    eq: (k: string, v: unknown) => { f.push(r => r[k] === v); return q; },
    in: (k: string, vs: unknown[]) => { f.push(r => vs.includes(r[k])); return q; },
    gte: (k: string, v: string) => { f.push(r => r[k] >= v); return q; },
    or: () => { f.push(r => r.source_url !== 'smoke-test'); return q; },   // NOT_SMOKE
    order: () => q, limit: (n: number) => { lim = n; return q; },
    maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (ok: any) => ok(run()),
  };
  return q;
};
function res() { const r: any = { code: 200, body: undefined, headers: {} as Record<string, string>, ended: false };
  r.status = (c: number) => { r.code = c; return r; }; r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k.toLowerCase()] = v; }; r.end = () => { r.ended = true; return r; }; return r; }

(async () => {
  assert.equal(isExternalEventType('call'), true); assert.equal(isExternalEventType('link'), false);

  // public endpoint: always 204, records only valid + entitled
  let r = res(); await trackExternalEvent({ params: { businessId: BIZ }, query: { t: 'call', u: 'https://shop.example.com/', r: '' } } as any, r);
  assert.equal(r.code, 204); assert.equal(r.headers['access-control-allow-origin'], '*');
  assert.equal(db.lead_events.length, 1);
  assert.equal(db.lead_events[0].business_id, BIZ); assert.equal(db.lead_events[0].landing_page_id, undefined);
  r = res(); await trackExternalEvent({ params: { businessId: BIZ }, query: { t: 'link' } } as any, r);
  assert.equal(r.code, 204); assert.equal(db.lead_events.length, 1, 'link is not an inquiry');
  r = res(); await trackExternalEvent({ params: { businessId: 'not-a-uuid' }, query: { t: 'call' } } as any, r);
  assert.equal(r.code, 204); assert.equal(db.lead_events.length, 1);
  r = res(); await trackExternalEvent({ params: { businessId: '99999999-9999-4999-8999-999999999999' }, query: { t: 'call' } } as any, r);
  assert.equal(r.code, 204); assert.equal(db.lead_events.length, 1, 'unknown business stores nothing');
  db.user_products[0].status = 'canceled';
  r = res(); await trackExternalEvent({ params: { businessId: BIZ }, query: { t: 'whatsapp' } } as any, r);
  assert.equal(r.code, 204); assert.equal(db.lead_events.length, 1, 'no active product -> nothing stored');
  db.user_products[0].status = 'active';
  process.env.SEO_TRACK_DAILY_CAP = '2';
  assert.equal(underEventCap('cap-biz'), true); assert.equal(underEventCap('cap-biz'), true); assert.equal(underEventCap('cap-biz'), false);
  delete process.env.SEO_TRACK_DAILY_CAP;

  // feed + counts
  db.lead_events.push({ id: 'w1', business_id: BIZ, event_type: 'whatsapp', source_url: 'https://shop/', created_at: new Date(2026, 9, 20).toISOString() });
  db.lead_events.push({ id: 'smoke', business_id: BIZ, event_type: 'call', source_url: 'smoke-test', created_at: new Date(2026, 9, 21).toISOString() });
  db.lead_events.push({ id: 'old', business_id: BIZ, event_type: 'call', source_url: 'x', created_at: new Date(2026, 0, 1).toISOString() });
  const ext = await getExternalLeads('o@x.co', new Date(2026, 9, 1).toISOString());
  assert.ok(ext.items.every(i => i.id !== 'smoke'), 'smoke events excluded');
  assert.ok(ext.items.some(i => i.id === 'w1' && i.page_name === 'שרברב דני (אתר חיצוני)' && i.landing_page_id === BIZ));
  assert.equal(ext.month.whatsapp, 1); assert.equal(ext.month.call, 1, 'only this month, no smoke'); assert.equal(ext.month.email, 0);
  assert.deepEqual((await getExternalLeads('nobody@x.co', '2000-01-01')).items, [], 'other accounts see nothing');
  dbError = true;
  assert.deepEqual((await getExternalLeads('o@x.co', '2000-01-01')).items, [], 'a failing query never throws');
  dbError = false;

  // getMyLeads: a customer with NO Pagey page still gets their external-site inquiries ...
  r = res(); await getMyLeads({ authEmail: 'o@x.co' } as any, r);
  assert.equal(r.code, 200); assert.ok(r.body.items.length >= 2);
  assert.equal(r.body.summary.month_whatsapp, 1);
  assert.equal(r.body.summary.month_total, r.body.summary.month_whatsapp + r.body.summary.month_call + r.body.summary.month_email);
  // ... and a customer with neither gets exactly the old empty answer
  r = res(); await getMyLeads({ authEmail: 'nobody@x.co' } as any, r);
  assert.deepEqual(r.body, { items: [], summary: { month_total: 0, month_whatsapp: 0, month_call: 0, month_form: 0, month_email: 0, month_link: 0 } });
  // ... and Pagey pages + external events merge into one feed
  db.landing_pages.push({ id: 'P1', owner_email: 'o@x.co', slug: 'danny', business_name: 'דף דני', parent_id: null });
  db.lead_events.push({ id: 'pw', landing_page_id: 'P1', event_type: 'whatsapp', source_url: 'https://p/', created_at: new Date(2026, 9, 22).toISOString() });
  r = res(); await getMyLeads({ authEmail: 'o@x.co' } as any, r);
  assert.equal(r.body.summary.month_whatsapp, 2, 'page + external whatsapp both counted');
  assert.deepEqual(r.body.items.map((i: any) => i.page_name).slice(0, 2), ['דף דני', 'שרברב דני (אתר חיצוני)']);
  console.log('external leads checks passed');
})().catch(e => { console.error(e); process.exit(1); });
