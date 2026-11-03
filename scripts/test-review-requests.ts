// Run: npx tsx scripts/test-review-requests.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import { addRequest, deleteRequest, listRequests, reviewedRequest, sentRequest } from '../src/controllers/reviewRequests.controller';
import { FOLLOWUP_AFTER_DAYS, MAX_PER_BUSINESS, nextStep, normalizePhone } from '../src/services/reviewRequests.service';

type Row = Record<string, any>;
const BIZ_A = '11111111-1111-4111-8111-111111111111', BIZ_B = '22222222-2222-4222-8222-222222222222';
const tables: Record<string, Row[]> = {
  seo_businesses: [{ id: BIZ_A, owner_email: 'a@x.co' }, { id: BIZ_B, owner_email: 'b@x.co' }],
  review_requests: [],
};
let seq = 0; let missing = false;
(supabase as any).from = (table: string) => {
  const t = tables[table]; const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {}; let head = false;
  const run = (single: boolean): any => {
    if (missing && table === 'review_requests') return { data: null, error: { code: '42P01', message: 'x' }, count: null };
    if (op === 'insert') {
      if (t.some((r) => r.business_id === patch.business_id && r.phone === patch.phone)) return { data: null, error: { code: '23505', message: 'dup' } };
      const r = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, status: 'new', sent_at: null, followup_sent_at: null, created_at: new Date().toISOString(), ...patch }; t.push(r); return { data: r, error: null };
    }
    if (op === 'update') { t.filter((r) => f.every((fn) => fn(r))).forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
    if (op === 'delete') { for (let i = t.length - 1; i >= 0; i--) if (f.every((fn) => fn(t[i]))) t.splice(i, 1); return { data: null, error: null }; }
    const rows = t.filter((r) => f.every((fn) => fn(r)));
    return { data: head ? null : (single ? rows[0] ?? null : rows), error: null, count: rows.length };
  };
  const q: any = {
    select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return q; }, order: () => q, limit: () => q,
    insert: (p: Row) => { op = 'insert'; patch = p; return q; }, update: (p: Row) => { op = 'update'; patch = p; return q; }, delete: () => { op = 'delete'; return q; },
    eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return q; },
    single: () => Promise.resolve(run(true)), maybeSingle: () => Promise.resolve(run(true)), then: (ok: any) => ok(run(false)),
  };
  return q;
};
const res = () => { const r: any = { code: 200, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const req = (email: string | undefined, o: { body?: any; query?: any; params?: any } = {}): any => ({ authEmail: email, body: o.body, query: o.query ?? {}, params: o.params ?? {} });

(async () => {
  // phones: Israeli mobile only, normalized
  assert.equal(normalizePhone('050-123 4567'), '972501234567');
  assert.equal(normalizePhone('+972 52 123 4567'), '972521234567');
  assert.equal(normalizePhone('972541234567'), '972541234567');
  assert.equal(normalizePhone('00972501234567'), '972501234567');
  for (const bad of ['', '021234567', '0771234567', '12345', '+14155552671', '05012345', '050123456789', 'abc', null as any]) assert.throws(() => normalizePhone(bad), `rejects ${bad}`);

  // next step rules: one request + one reminder, a week apart
  const now = new Date('2026-11-10T10:00:00Z');
  const ago = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();
  assert.equal(nextStep({ status: 'new', sent_at: null, followup_sent_at: null }, now).next, 'send');
  assert.deepEqual(nextStep({ status: 'sent', sent_at: ago(2), followup_sent_at: null }, now), { next: 'wait', waitDays: 5 });
  assert.equal(nextStep({ status: 'sent', sent_at: ago(FOLLOWUP_AFTER_DAYS), followup_sent_at: null }, now).next, 'followup');
  assert.equal(nextStep({ status: 'sent', sent_at: ago(30), followup_sent_at: ago(20) }, now).next, 'done', 'never a third message');
  assert.equal(nextStep({ status: 'reviewed', sent_at: ago(30), followup_sent_at: null }, now).next, 'done');

  // API
  let r = res(); await listRequests(req(undefined), r); assert.equal(r.code, 401);
  r = res(); await listRequests(req('a@x.co', { query: { businessId: 'nope' } }), r); assert.equal(r.code, 400);
  r = res(); await listRequests(req('a@x.co', { query: { businessId: BIZ_B } }), r); assert.equal(r.code, 404, "another account's business");
  r = res(); await addRequest(req('a@x.co', { body: { businessId: BIZ_B, name: 'דנה', phone: '0501234567' } }), r); assert.equal(r.code, 404);
  r = res(); await addRequest(req('a@x.co', { body: { businessId: BIZ_A, name: 'דנה', phone: '021234567' } }), r); assert.equal(r.code, 400);
  r = res(); await addRequest(req('a@x.co', { body: { businessId: BIZ_A, name: '<b>x</b>', phone: '0501234567' } }), r); assert.equal(r.code, 400);
  r = res(); await addRequest(req('a@x.co', { body: { businessId: BIZ_A, name: 'דנה', phone: '050-123-4567' } }), r); assert.equal(r.code, 200);
  assert.equal(r.body.item.phone, '972501234567'); assert.equal(r.body.item.next, 'send');
  const id = r.body.item.id;
  r = res(); await addRequest(req('a@x.co', { body: { businessId: BIZ_A, name: 'דנה שוב', phone: '+972501234567' } }), r); assert.equal(r.code, 409, 'same person twice');

  // sending: first request, then a reminder is too soon, then allowed after a week, then never again
  r = res(); await sentRequest(req('a@x.co', { params: { id } }), r); assert.equal(r.code, 200); assert.equal(r.body.item.status, 'sent'); assert.equal(r.body.item.next, 'wait');
  r = res(); await sentRequest(req('a@x.co', { params: { id } }), r); assert.equal(r.code, 409, 'reminder too soon');
  r = res(); await sentRequest(req('b@x.co', { params: { id } }), r); assert.equal(r.code, 404, "not someone else's");
  tables.review_requests[0].sent_at = new Date(Date.now() - 8 * 86400000).toISOString();
  r = res(); await sentRequest(req('a@x.co', { params: { id } }), r); assert.equal(r.code, 200, 'reminder after a week');
  assert.ok(tables.review_requests[0].followup_sent_at);
  r = res(); await sentRequest(req('a@x.co', { params: { id } }), r); assert.equal(r.code, 409, 'no third message');
  r = res(); await reviewedRequest(req('a@x.co', { params: { id } }), r); assert.equal(r.body.item.next, 'done');
  r = res(); await listRequests(req('a@x.co', { query: { businessId: BIZ_A } }), r); assert.equal(r.body.items.length, 1);

  // limit
  for (let i = 0; i < MAX_PER_BUSINESS - 1; i++) tables.review_requests.push({ id: 'x' + i, business_id: BIZ_A, owner_email: 'a@x.co', phone: '9725000' + String(i).padStart(5, '0'), status: 'new' });
  r = res(); await addRequest(req('a@x.co', { body: { businessId: BIZ_A, name: 'עוד', phone: '0509999999' } }), r); assert.equal(r.code, 409); assert.equal(r.body.code, 'limit');

  // delete + not migrated
  r = res(); await deleteRequest(req('a@x.co', { params: { id } }), r); assert.equal(r.code, 200); assert.ok(!tables.review_requests.some((x) => x.id === id));
  missing = true; r = res(); await listRequests(req('a@x.co', { query: { businessId: BIZ_A } }), r); assert.equal(r.code, 503);
  console.log('review requests checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
