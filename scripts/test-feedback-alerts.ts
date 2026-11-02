// Run: npx ts-node --transpile-only scripts/test-feedback-alerts.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import { adminListFeedback, adminMarkSeen, sendFeedback } from '../src/controllers/feedback.controller';
import { DAILY_LIMIT, cleanInput } from '../src/services/feedback.service';
import { allowAlert, describeRequest, notifyOwner, resetAlertState, type AlertSender } from '../src/services/alerts';

type Row = Record<string, any>;
const db: Row[] = []; let missing = false; let seq = 0;
(supabase as any).from = (table: string) => {
  assert.equal(table, 'seo_feedback');
  const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {}; let head = false;
  const run = (single: boolean): any => {
    if (missing) return { data: null, error: { code: '42P01', message: 'relation does not exist' }, count: null };
    if (op === 'insert') { const r = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, seen: false, created_at: new Date().toISOString(), ...patch }; db.push(r); return { data: r, error: null }; }
    if (op === 'update') { db.filter((r) => f.every((fn) => fn(r))).forEach((r) => Object.assign(r, patch)); return { data: null, error: null }; }
    const rows = db.filter((r) => f.every((fn) => fn(r)));
    return { data: head ? null : (single ? rows[0] : rows), error: null, count: rows.length };
  };
  const q: any = {
    select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return q; }, order: () => q, limit: () => q,
    insert: (p: Row) => { op = 'insert'; patch = p; return q; },
    update: (p: Row) => { op = 'update'; patch = p; return q; },
    eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return q; },
    gte: (k: string, v: string) => { f.push((r) => r[k] >= v); return q; },
    single: () => Promise.resolve(run(true)),
    then: (ok: any) => ok(run(false)),
  };
  return q;
};
const res = () => { const r: any = { code: 200, body: null }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };
const req = (email: string | undefined, body?: any, params?: any): any => ({ authEmail: email, body, params });

(async () => {
  // input cleaning
  assert.deepEqual(cleanInput('bug', '  לא עובד  ', 'profile'), { kind: 'bug', message: 'לא עובד', page: 'profile' });
  assert.equal(cleanInput('???', 'הודעה ארוכה מספיק', 'http://evil/?t=1').kind, 'other');
  assert.equal(cleanInput('idea', 'הודעה ארוכה מספיק', 'http://evil/?t=1').page, null, 'page is a label, not a URL');
  assert.throws(() => cleanInput('bug', 'ab', null)); assert.throws(() => cleanInput('bug', 5, null)); assert.throws(() => cleanInput('bug', 'x'.repeat(2001), null));

  // sending
  let r = res(); await sendFeedback(req(undefined, { message: 'hello there' }), r); assert.equal(r.code, 401);
  r = res(); await sendFeedback(req('a@x.co', { message: 'x' }), r); assert.equal(r.code, 400);
  r = res(); await sendFeedback(req('a@x.co', { kind: 'bug', message: 'הכפתור לא עובד', page: 'profile' }), r); assert.equal(r.code, 200);
  assert.equal(db.length, 1); assert.equal(db[0].email, 'a@x.co');
  for (let i = 1; i < DAILY_LIMIT; i++) { r = res(); await sendFeedback(req('a@x.co', { message: `עוד הודעה ${i}` }), r); assert.equal(r.code, 200); }
  r = res(); await sendFeedback(req('a@x.co', { message: 'הודעה אחת יותר מדי' }), r); assert.equal(r.code, 429, 'daily cap per account');
  r = res(); await sendFeedback(req('b@x.co', { message: 'חשבון אחר' }), r); assert.equal(r.code, 200, 'cap is per account');

  // admin
  r = res(); await adminListFeedback(req('x'), r); assert.equal(r.body.items.length, DAILY_LIMIT + 1);
  const id = db[0].id;
  r = res(); await adminMarkSeen(req('x', { seen: true }, { id }), r); assert.equal(r.code, 200); assert.equal(db[0].seen, true);
  r = res(); await adminMarkSeen(req('x', {}, { id: 'nope' }), r); assert.equal(r.code, 400);
  missing = true;
  r = res(); await adminListFeedback(req('x'), r); assert.equal(r.code, 200); assert.equal(r.body.notMigrated, true);
  r = res(); await sendFeedback(req('a@x.co', { message: 'לפני מיגרציה' }), r); assert.equal(r.code, 503);
  missing = false;

  // alerts: off by default
  const sent: string[] = [];
  const sender: AlertSender = { webhook: async (t) => { sent.push('w:' + t); }, email: async (_s, t) => { sent.push('e:' + t); } };
  delete process.env.ALERTS_ENABLED; resetAlertState();
  assert.equal(await notifyOwner('boom', 'k', sender), false); assert.equal(sent.length, 0);

  // alerts: on, de-duplicated per key, capped per hour
  process.env.ALERTS_ENABLED = 'true'; resetAlertState();
  assert.equal(await notifyOwner('שגיאה א', 'k1', sender), true); assert.equal(sent.length, 2, 'webhook + email');
  assert.equal(await notifyOwner('שגיאה א שוב', 'k1', sender), false, 'same key within 15 minutes is suppressed');
  assert.equal(await notifyOwner('שגיאה ב', 'k2', sender), true);
  resetAlertState();
  const t0 = 1_000_000;
  assert.equal(allowAlert('k', t0), true); assert.equal(allowAlert('k', t0 + 14 * 60000), false); assert.equal(allowAlert('k', t0 + 16 * 60000), true, 'allowed again after 15 minutes');
  resetAlertState();
  let okCount = 0; for (let i = 0; i < 40; i++) if (allowAlert('key' + i, t0)) okCount++;
  assert.equal(okCount, 30, 'hourly cap');
  assert.equal(allowAlert('later', t0 + 61 * 60000), true, 'new hour resets');

  // a failing channel never throws
  resetAlertState();
  assert.equal(await notifyOwner('x', 'z', { webhook: async () => { throw new Error('down'); }, email: async () => undefined }), true);

  // no query strings (they can hold tokens)
  assert.equal(describeRequest('GET', '/api/x?token=SECRET&a=1'), 'GET /api/x');

  console.log('feedback + alerts checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
