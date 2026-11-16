// Audit 16.11: failures of the automatic product are no longer silent, a broken Google connection is
// told to the customer once, and the draft sweep never touches a promotion subscriber's page.
// No network, no database: supabase is an in-memory fake.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import { sweepError, withHeartbeat } from '../src/services/opsMetrics.service';
import { markNeedsReconnect } from '../src/services/gbpStore';
import { buildReconnectEmail, sendReconnectNotice } from '../src/services/reconnectNotice';
import { promotionAccounts, runDraftSweep } from '../src/services/draftCleanup.service';
import { healthSnapshot } from '../src/services/adminHealth.service';

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
(supabase as any).from = (table: string) => {
  db[table] ??= [];
  const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {}; let head = false; let onConflict: string[] = [];
  const rows = () => db[table].filter((r) => f.every((fn) => fn(r)));
  const run = (): any => {
    if (op === 'update') { const hit = rows(); hit.forEach((r) => Object.assign(r, patch)); return { data: hit, error: null }; }
    if (op === 'delete') { const hit = rows(); db[table] = db[table].filter((r) => !hit.includes(r)); return { data: hit, error: null }; }
    if (op === 'upsert') {
      const ex = db[table].find((r) => onConflict.every((c) => r[c] === patch[c]));
      if (ex) Object.assign(ex, patch); else db[table].push({ ...patch });
      return { data: null, error: null };
    }
    const hit = rows();
    return head ? { data: null, count: hit.length, error: null } : { data: hit, count: hit.length, error: null };
  };
  const q: any = {
    select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) head = true; return q; },
    limit: () => q, order: () => q,
    update: (p: Row) => { op = 'update'; patch = p; return q; },
    delete: () => { op = 'delete'; return q; },
    upsert: (p: Row, o: { onConflict: string }) => { op = 'upsert'; patch = p; onConflict = o.onConflict.split(','); return q; },
    eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return q; },
    neq: (k: string, v: unknown) => { f.push((r) => r[k] !== v); return q; },
    is: (k: string, v: unknown) => { f.push((r) => (r[k] ?? null) === v); return q; },
    in: (k: string, vs: unknown[]) => { f.push((r) => vs.includes(r[k])); return q; },
    lte: (k: string, v: string) => { f.push((r) => r[k] <= v); return q; },
    gte: (k: string, v: string) => { f.push((r) => r[k] >= v); return q; },
    or: () => q, not: () => q,
    maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (ok: any) => ok(run()),
  };
  return q;
};

(async () => {
  const NOW = new Date('2026-11-16T10:00:00Z');

  // ── 1. a sweep that failed for some accounts is recorded as failing ──
  assert.equal(sweepError({ accounts: 3, failed: 0 }), null);
  assert.equal(sweepError(4), null, 'a sweep that returns a number is judged by finishing only');
  assert.match(sweepError({ failed: 2 })!, /2 account/);
  db.job_heartbeats = [];
  await withHeartbeat('gbp_posts', async () => ({ accounts: 2, failed: 1 }));
  assert.ok(db.job_heartbeats[0].last_error && !db.job_heartbeats[0].last_ok_at, 'one failed account -> failing, not ok');
  await withHeartbeat('auto_replies', async () => ({ accounts: 2, failed: 0 }));
  assert.ok(db.job_heartbeats.find((r) => r.job === 'auto_replies')!.last_ok_at);

  // ── 2. a broken Google connection: one email per break ──
  const told: string[] = [];
  const notify = async (e: string) => { told.push(e); };
  db.gbp_connections = [{ email: 'a@x.co', status: 'active', last_error: null }];
  assert.equal(await markNeedsReconnect('a@x.co', 'revoked', notify), true);
  assert.equal(await markNeedsReconnect('a@x.co', 'revoked again', notify), false);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(told, ['a@x.co'], 'told once, however many sweeps find the break');
  assert.deepEqual([db.gbp_connections[0].status, db.gbp_connections[0].last_error], ['needs_reconnect', 'revoked again']);
  db.gbp_connections[0].status = 'active';                                     // the customer reconnected
  assert.equal(await markNeedsReconnect('a@x.co', 'revoked', notify), true, 'a new break is told again');
  assert.equal(await markNeedsReconnect('nobody@x.co', 'revoked', notify), false);

  const mail = buildReconnectEmail('אינסטלציה דני', 'https://api.test/unsub?t=x');
  assert.ok(mail.subject.includes('אינסטלציה דני') && mail.text.includes('/dashboard') && mail.text.includes('https://api.test/unsub?t=x'));
  assert.ok(/אנחנו לא יכולים לפרסם פוסטים ולענות לביקורות/.test(mail.text) && /תחברו/.test(mail.text), 'says what stopped and what to do, plural voice');
  assert.ok(!buildReconnectEmail('<b>x</b>', 'u').html.includes('<b>x</b>'), 'the business name is escaped');

  const sent: string[] = [];
  const deps = { recipients: async () => ['a@x.co'], business: async () => 'עסק', send: async (to: string) => { sent.push(to); } };
  delete process.env.DIGEST_SECRET; delete process.env.RESEND_API_KEY;
  assert.equal(await sendReconnectNotice('a@x.co', deps), false, 'no unsubscribe secret or mail key: nothing is sent');
  process.env.DIGEST_SECRET = 's'; process.env.RESEND_API_KEY = 'k';
  assert.equal(await sendReconnectNotice('a@x.co', deps), true);
  assert.equal(await sendReconnectNotice('gone@x.co', deps), false, 'no product or unsubscribed: not mailed');
  assert.equal(await sendReconnectNotice('a@x.co', { ...deps, send: async () => { throw new Error('resend down'); } }), false, 'a failed send never throws');
  assert.deepEqual(sent, ['a@x.co']);
  delete process.env.DIGEST_SECRET; delete process.env.RESEND_API_KEY;

  // ── 3. the draft sweep never touches a promotion subscriber's page ──
  const old = new Date(NOW.getTime() - 40 * 86_400_000).toISOString();
  db.user_products = [
    { email: 'sub@x.co', product: 'seo_autopilot', status: 'active', current_period_end: null },
    { email: 'ended@x.co', product: 'seo_autopilot', status: 'canceled', current_period_end: old },
  ];
  db.landing_pages = [
    { id: 'p-sub', owner_email: 'sub@x.co', status: 'draft', parent_id: null, draft_clock_at: old, slug: 's' },
    { id: 'p-sub-kid', owner_email: 'sub@x.co', status: 'draft', parent_id: 'p-sub', draft_clock_at: old, slug: 's2' },
    { id: 'p-ended', owner_email: 'ended@x.co', status: 'draft', parent_id: null, draft_clock_at: old, slug: 'e' },
    { id: 'p-plain', owner_email: 'plain@x.co', status: 'draft', parent_id: null, draft_clock_at: old, slug: 'p' },
  ];
  db.leads = [];
  assert.deepEqual([...(await promotionAccounts(NOW))!], ['sub@x.co']);
  const swept = await runDraftSweep(NOW);
  assert.equal(swept.deleted, 2, 'abandoned drafts of other accounts are still cleaned up');
  assert.deepEqual(db.landing_pages.map((p) => p.id).sort(), ['p-sub', 'p-sub-kid'], 'the subscriber\'s page and its phrase pages stay');
  assert.ok(!db.landing_pages.find((p) => p.id === 'p-sub')!.draft_warning_30d_at, 'and no "will be deleted" mail was claimed for it');

  // ── 4. health: a connection that needs reconnecting, or a post that gave up, is mailed to the owner ──
  db.gbp_connections = [{ email: 'a@x.co', status: 'needs_reconnect', connected_at: NOW.toISOString() }];
  db.gbp_posts = [{ id: 'x', status: 'failed', updated_at: NOW.toISOString() }];
  db.job_heartbeats = []; db.places_usage = []; db.user_profiles = [{ email: 'a@x.co' }];
  db.seo_subscription_events = []; db.seo_subscriptions = [];
  const snap = await healthSnapshot(NOW);
  const bad = snap.alerts.filter((a) => a.level === 'bad').map((a) => a.text);
  assert.ok(bad.some((t) => /חיבורי גוגל דורשים חיבור מחדש/.test(t)), 'needs reconnect is a bad-level alert');
  assert.ok(bad.some((t) => /פוסטים שבועיים לא פורסמו/.test(t)), 'a failed weekly post is a bad-level alert');

  console.log('autopilot reliability: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
