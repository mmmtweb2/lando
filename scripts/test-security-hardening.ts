// Run: npx ts-node --transpile-only scripts/test-security-hardening.ts
// Admin gate ordering + throttles, public lead form validation/limits/caps, URL validation,
// generic error messages. Real express app, mocked Supabase, no network.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= 'fake';
delete process.env.RESEND_API_KEY;
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
/* eslint-disable @typescript-eslint/no-var-requires */
const { supabase } = require('../src/config/supabase') as typeof import('../src/config/supabase');
const app = require('../src/app').default as import('express').Express;
const { parseHttpUrl, optionalHttpUrl } = require('../src/utils/safeUrl') as typeof import('../src/utils/safeUrl');
const { validateLeadInput, LEAD_LIMITS } = require('../src/utils/leadInput') as typeof import('../src/utils/leadInput');
const guard = require('../src/services/pageLeadGuard') as typeof import('../src/services/pageLeadGuard');
const { serverError, GENERIC_SERVER_ERROR } = require('../src/utils/httpErrors') as typeof import('../src/utils/httpErrors');

// ── pure: URLs ──
for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd',
  'ftp://x.co/a', '//evil.co/x', 'https://user:pw@evil.co/', 'https://', 'https://exa mple.com', 'https://x.co/<script>', 'https://x.co/"onmouseover="1', 'x', '', '   ', 'java\nscript:alert(1)', 'https://' + 'a'.repeat(2100) + '.co', 'mailto:a@b.co', 'tel:0501234567', 'blob:https://x.co/1'])
  assert.equal(parseHttpUrl(bad), null, `rejected: ${bad.slice(0, 40)}`);
for (const nonStr of [undefined, null, 5, {}, ['https://x.co']]) assert.equal(parseHttpUrl(nonStr as any), null);
assert.equal(parseHttpUrl('https://www.facebook.com/dani.cafe'), 'https://www.facebook.com/dani.cafe');
assert.equal(parseHttpUrl('  http://example.co/a?b=1#c '), 'http://example.co/a?b=1#c');
assert.equal(parseHttpUrl('facebook.com/x'), null, 'strict mode: no bare host');
assert.equal(parseHttpUrl('facebook.com/x', { allowBare: true }), 'https://facebook.com/x');
assert.equal(parseHttpUrl('javascript:alert(1)', { allowBare: true }), null);
assert.equal(parseHttpUrl('localhost:3000/x', { allowBare: true }), null, 'a "scheme:" is never a bare host');
assert.deepEqual(optionalHttpUrl(undefined), { ok: true, value: null });
assert.deepEqual(optionalHttpUrl('  '), { ok: true, value: null });
assert.deepEqual(optionalHttpUrl('instagram.com/a'), { ok: true, value: 'https://instagram.com/a' });
assert.deepEqual(optionalHttpUrl('javascript:alert(1)'), { ok: false });
assert.deepEqual(optionalHttpUrl(['https://x.co'] as any), { ok: false });

// ── pure: lead input ──
const good = { name: ' דני ', phone: '050-123 4567', email: 'a@b.co', message: 'שלום\nעולם' };
let v = validateLeadInput(good); assert.ok(v.ok); if (v.ok) { assert.equal(v.value.name, 'דני'); assert.equal(v.value.email, 'a@b.co'); assert.equal(v.value.message, 'שלום\nעולם'); }
v = validateLeadInput({ name: 'a', phone: '0501234567' }); assert.ok(v.ok && v.value.email === null && v.value.message === null);
v = validateLeadInput({ name: 'a', phone: '0501234567', email: '  ', message: '' }); assert.ok(v.ok && v.value.email === null);
for (const bad of [null, [], 'x', { name: 'a' }, { phone: '0501234567' }, { name: '', phone: '0501234567' },
  { name: { $ne: 1 }, phone: '0501234567' }, { name: 'a', phone: 501234567 }, { name: ['a'], phone: '0501234567' },
  { name: 'a'.repeat(LEAD_LIMITS.name + 1), phone: '0501234567' }, { name: 'a\u0000b', phone: '0501234567' },
  { name: 'a', phone: '0501234567'.padEnd(31, '1') }, { name: 'a', phone: 'abc' }, { name: 'a', phone: '123' }, { name: 'a', phone: '1'.repeat(16) },
  { name: 'a', phone: '0501234567', email: 'nope' }, { name: 'a', phone: '0501234567', email: 5 }, { name: 'a', phone: '0501234567', email: 'a@b.co'.padStart(260, 'x') },
  { name: 'a', phone: '0501234567', message: 'm'.repeat(LEAD_LIMITS.message + 1) }, { name: 'a', phone: '0501234567', message: { a: 1 } },
  { name: 'a', phone: '0501234567', message: 'x\u0007y' }]) assert.equal(validateLeadInput(bad as any).ok, false, JSON.stringify(bad)?.slice(0, 60));
v = validateLeadInput({ name: 'a', phone: '0501234567', message: 'm'.repeat(LEAD_LIMITS.message) }); assert.ok(v.ok, 'exactly at the limit is fine');

// ── pure: caps ──
guard.resetPageLeadCounters(); process.env.PAGE_LEAD_PER_PAGE_DAILY_CAP = '2'; process.env.PAGE_LEAD_DAILY_CAP = '3';
const t0 = new Date('2026-11-03T10:00:00Z');
assert.equal(guard.takePageLead('p1', t0), 'ok'); assert.equal(guard.takePageLead('p1', t0), 'ok');
assert.equal(guard.takePageLead('p1', t0), 'page_cap'); assert.equal(guard.takePageLead('p2', t0), 'ok');
assert.equal(guard.takePageLead('p3', t0), 'global_cap');
guard.releasePageLead('p2'); assert.equal(guard.takePageLead('p3', t0), 'ok', 'a released slot is reusable');
assert.equal(guard.takePageLead('p1', new Date('2026-11-04T00:00:01Z')), 'ok', 'resets at UTC midnight');
delete process.env.PAGE_LEAD_PER_PAGE_DAILY_CAP; delete process.env.PAGE_LEAD_DAILY_CAP; guard.resetPageLeadCounters();
assert.equal(guard.pageLeadDailyCap(), 3000); assert.equal(guard.pageLeadPerPageDailyCap(), 200);

// ── pure: generic errors ──
{
  const out: any = { code: 0, body: null }; const res: any = { status: (c: number) => { out.code = c; return res; }, json: (b: any) => { out.body = b; } };
  const log = console.error; let logged = ''; console.error = (...a: unknown[]) => { logged = a.join(' '); };
  serverError(res, { message: 'duplicate key value violates unique constraint "payments_x_key"' }, '[T]');
  console.error = log;
  assert.equal(out.code, 500); assert.equal(out.body.error, GENERIC_SERVER_ERROR); assert.ok(!JSON.stringify(out.body).includes('constraint'));
  assert.ok(logged.includes('payments_x_key'), 'detail is logged server-side');
}

// ── HTTP against the real app ──
type Row = Record<string, any>;
const tokens: Record<string, { email: string; admin: boolean }> = { 'tok-admin': { email: 'adm@x.co', admin: true }, 'tok-user': { email: 'usr@x.co', admin: false } };
(supabase.auth as any).getUser = async (t: string) => tokens[t] ? { data: { user: { id: 'u', email: tokens[t].email } }, error: null } : { data: { user: null }, error: { message: 'bad' } };
let pageRow: Row | null = { owner_email: 'o@x.co', business_name: 'עסק', page_goal: 'lead_gen', status: 'published', enable_form: true, parent_id: null };
const inserted: Row[] = []; let insertError = false;
(supabase as any).from = (table: string) => {
  const q: any = {}; let isInsert = false; let payload: Row = {};
  q.select = () => q; q.eq = () => q; q.maybeSingle = () => q.single();
  q.insert = (p: Row) => { isInsert = true; payload = p; return q; };
  q.single = async () => {
    if (table === 'user_profiles') { return { data: { is_admin: [...Object.values(tokens)].some(() => true) && currentAdmin }, error: null }; }
    if (table === 'landing_pages') return pageRow ? { data: pageRow, error: null } : { data: null, error: { message: 'x' } };
    if (table === 'leads' && isInsert) { if (insertError) return { data: null, error: { message: 'secret table detail' } }; inserted.push(payload); return { data: { id: 'L' + inserted.length }, error: null }; }
    return { data: null, error: null };
  };
  return q;
};
let currentAdmin = false; // user_profiles.is_admin answer, set per request group below

function call(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: unknown, raw?: string): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const req = http.request({ port, host: '127.0.0.1', method, path, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(data)) } : {}), ...headers } }, (r) => {
      let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => { let j: any = null; try { j = JSON.parse(b); } catch { /* not json */ } resolve({ status: r.statusCode ?? 0, json: j }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

(async () => {
  const server = app.listen(0); const port = (server.address() as AddressInfo).port;
  const quiet = console.warn; console.warn = () => undefined;
  try {
    // ---------- admin gate order ----------
    const { _resetAdminPasswordFailuresForTests } = require('../src/middleware/adminPassword.middleware');
    process.env.ADMIN_PANEL_PASSWORD = 'correct-horse';
    const A = (tok: string, pw?: string) => ({ authorization: `Bearer ${tok}`, ...(pw ? { 'x-admin-password': pw } : {}) });
    let r = await call(port, 'GET', '/api/admin/gbp-config'); assert.equal(r.status, 401); assert.ok(!r.json.adminPassword, 'unauthenticated callers learn nothing about the password gate');
    r = await call(port, 'GET', '/api/admin/gbp-config', { authorization: 'Bearer nope' }, undefined); assert.equal(r.status, 401); assert.ok(!r.json.adminPassword);
    currentAdmin = false;
    r = await call(port, 'GET', '/api/admin/gbp-config', A('tok-user', 'correct-horse')); assert.equal(r.status, 403, 'non-admin refused before the password is looked at');
    r = await call(port, 'GET', '/api/admin/gbp-config', A('tok-user', 'WRONG')); assert.equal(r.status, 403); assert.ok(!r.json.adminPassword, 'a non-admin never learns whether the password was right');
    currentAdmin = true;
    r = await call(port, 'GET', '/api/admin/gbp-config', A('tok-admin')); assert.equal(r.status, 401); assert.equal(r.json.adminPassword, true, 'admin without password -> client re-prompts');
    r = await call(port, 'GET', '/api/admin/gbp-config', A('tok-admin', 'WRONG')); assert.equal(r.status, 401); assert.equal(r.json.error, 'סיסמה שגויה.');
    r = await call(port, 'GET', '/api/admin/gbp-config', A('tok-admin', 'correct-horse')); assert.equal(r.status, 200, 'admin + password still works');
    delete process.env.ADMIN_PANEL_PASSWORD;
    r = await call(port, 'GET', '/api/admin/gbp-config', A('tok-admin', 'x')); assert.equal(r.status, 503, 'unset password still fails closed');
    process.env.ADMIN_PANEL_PASSWORD = 'correct-horse';
    // wrong-password throttle: 10 wrong attempts then 429, even for the right password until the window passes
    _resetAdminPasswordFailuresForTests();
    for (let i = 0; i < 10; i++) { r = await call(port, 'GET', '/api/admin/gbp-config', A('tok-admin', 'bad' + i)); assert.equal(r.status, 401); }
    r = await call(port, 'GET', '/api/admin/gbp-config', A('tok-admin', 'bad-again')); assert.equal(r.status, 429); assert.equal(r.json.adminPassword, true);
    r = await call(port, 'GET', '/api/admin/gbp-config', A('tok-admin', 'correct-horse')); assert.equal(r.status, 429);
    _resetAdminPasswordFailuresForTests();
    r = await call(port, 'GET', '/api/admin/gbp-config', A('tok-admin', 'correct-horse')); assert.equal(r.status, 200);
    // per-IP rate limit on the whole area (120/min): we have made ~22 requests so far
    let limited = 0; for (let i = 0; i < 130; i++) { r = await call(port, 'GET', '/api/admin/gbp-config', A('tok-admin', 'correct-horse')); if (r.status === 429) limited++; }
    assert.ok(limited > 0 && limited <= 40, `admin area rate limited (got ${limited} x 429)`);
    assert.ok(r.json.error.includes('אזור הניהול') || r.json.adminPassword === undefined);

    // ---------- public lead form ----------
    const L = (id: string, body: unknown, raw?: string) => call(port, 'POST', `/api/landing/${id}/lead`, {}, body, raw);
    r = await L('page-a', { name: 'דני', phone: '0501234567', email: 'd@x.co', message: 'היי' }); assert.equal(r.status, 201); assert.equal(inserted.length, 1);
    assert.deepEqual(Object.keys(inserted[0]).sort(), ['email', 'landing_page_id', 'message', 'name', 'phone']);
    r = await L('page-b', { name: { $gt: '' }, phone: '0501234567' }); assert.equal(r.status, 400, 'object instead of string');
    r = await L('page-b', { name: 'דני', phone: 'abc' }); assert.equal(r.status, 400);
    r = await L('page-b', { name: 'x'.repeat(101), phone: '0501234567' }); assert.equal(r.status, 400);
    r = await L('page-b', { name: 'דני', phone: '0501234567', message: 'm'.repeat(2001) }); assert.equal(r.status, 400);
    r = await L('page-b', { name: 'דני', phone: '0501234567', message: 'm'.repeat(12 * 1024) }); assert.equal(r.status, 413, 'oversize body rejected before validation');
    r = await L('page-b', undefined, '[1,2,3]'); assert.equal(r.status, 400);
    assert.equal(inserted.length, 1, 'no rejected request reached the database');
    // draft page does not burn the daily budget
    guard.resetPageLeadCounters(); pageRow = { ...pageRow!, status: 'draft' };
    r = await L('page-c', { name: 'דני', phone: '0501234567' }); assert.equal(r.status, 403);
    assert.equal(guard.takePageLead('page-c'), 'ok'); guard.releasePageLead('page-c');
    pageRow = { ...pageRow!, status: 'published' };
    // failed insert gives the slot back and hides the DB message
    insertError = true; guard.resetPageLeadCounters();
    const logE = console.error; console.error = () => undefined;
    r = await L('page-d', { name: 'דני', phone: '0501234567' }); console.error = logE;
    assert.equal(r.status, 500); assert.ok(!JSON.stringify(r.json).includes('secret')); insertError = false;
    // per IP+page bucket: 5 / 10 min on one page (page-a used 1, page-d used 1 -> use a fresh page)
    let codes: number[] = []; for (let i = 0; i < 7; i++) codes.push((await L('page-e', { name: 'דני', phone: '0501234567' })).status);
    assert.ok(codes.slice(0, 5).every((c) => c === 201 || c === 429), codes.join()); assert.ok(codes.includes(429), `per-page bucket kicks in: ${codes}`);

    // ---------- createLandingPage rejects dangerous owner links BEFORE any cost ----------
    const { createLandingPage } = require('../src/controllers/landing.controller') as typeof import('../src/controllers/landing.controller');
    const base = { business_name: 'קפה', phone_number: '0501234567', vibe: 'חם' };
    for (const field of ['facebook_url', 'instagram_url', 'external_link']) {
      const out: any = { code: 0, body: null }; const res: any = { status: (c: number) => { out.code = c; return res; }, json: (b: any) => { out.body = b; return res; } };
      const log = console.log; const seen: string[] = []; console.log = (...a: unknown[]) => { seen.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
      await createLandingPage({ body: { ...base, [field]: 'javascript:alert(document.cookie)' }, files: {}, authEmail: 'o@x.co' } as any, res);
      console.log = log;
      assert.ok(!seen.join('\n').match(/0501234567|javascript|o@x\.co|קפה/), 'request body / PII is not logged');
      assert.equal(out.code, 400, field); assert.match(out.body.error, /אינו תקין/);
    }
  } finally { console.warn = quiet; server.close(); }
  console.log('security hardening checks passed');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
