// Run: npx tsx scripts/test-draft-optout.ts
// One-click unsubscribe from the abandoned-draft reminder emails (legal audit 16.11).
import assert from 'node:assert/strict';
import { supabase } from '../src/config/supabase';
import { signUnsub, verifyUnsub } from '../src/services/digest.service';
import { draftUnsubUrl, verifyDraftUnsub } from '../src/services/draftOptOut';
import { buildEmailHtml } from '../src/services/draft.mailer';
import { sendDueDraftReminders } from '../src/services/draftCleanup.service';
import { draftUnsubscribeApply, draftUnsubscribePage } from '../src/controllers/digest.controller';

process.env.DIGEST_SECRET = 'test-secret-123';

// ── tokens: scoped to their purpose ──
const url = draftUnsubUrl('a@x.co')!;
assert.ok(url.includes('/api/users/email/drafts/unsubscribe?t='));
const tok = decodeURIComponent(url.split('t=')[1]);
assert.equal(verifyDraftUnsub(tok), 'a@x.co');
assert.equal(verifyUnsub(tok), null, 'a draft token cannot stop the monthly digest');
assert.equal(verifyDraftUnsub(signUnsub('a@x.co')), null, 'a digest token cannot stop draft reminders');
assert.equal(verifyDraftUnsub(tok, 'other'), null);
assert.equal(draftUnsubUrl('a@x.co', ''), null, 'no secret -> no link');

// ── the email: sender line, reason, unsubscribe link ──
const { html } = buildEmailHtml({ kind: 'day1', to: 'a@x.co', businessName: 'קפה <נעמי>', unsubUrl: url });
assert.match(html, /נשלח מ-Pagey \(pagey\.co\.il\)/);
assert.match(html, /להפסקת הודעות מהסוג הזה/);
assert.ok(html.includes('קפה &lt;נעמי&gt;') && !html.includes('קפה <נעמי>'), 'business name escaped in the footer');
assert.ok(!buildEmailHtml({ kind: 'day1', to: 'a@x.co', businessName: 'x' }).html.includes('להפסקת הודעות'), 'no link when none given');

// ── fake supabase: drafts, prefs ──
type Row = Record<string, any>;
const db: Record<string, Row[]> = {
  landing_pages: [
    { id: 'p1', business_name: 'A', owner_email: 'out@x.co', status: 'draft', parent_id: null, draft_clock_at: '2026-01-01T00:00:00Z', draft_reminder_1d_at: null, draft_reminder_7d_at: null, draft_warning_30d_at: null },
    { id: 'p2', business_name: 'B', owner_email: 'in@x.co', status: 'draft', parent_id: null, draft_clock_at: '2026-01-01T00:00:00Z', draft_reminder_1d_at: null, draft_reminder_7d_at: null, draft_warning_30d_at: null },
  ],
  seo_email_prefs: [{ email: 'out@x.co', monthly_digest: true, draft_reminders: false }],
};
const upserts: Row[] = [];
(supabase as any).from = (table: string) => {
  const f: Array<(r: Row) => boolean> = []; let op = 'select'; let patch: Row = {};
  const rows = () => db[table].filter((r) => f.every((fn) => fn(r)));
  const run = () => {
    if (op === 'update') { const hit = rows(); hit.forEach((r) => Object.assign(r, patch)); return { data: hit, error: null }; }
    if (op === 'upsert') { upserts.push(patch); return { data: null, error: null }; }
    return { data: rows(), error: null };
  };
  const q: any = {
    select: () => q, limit: () => q,
    update: (p: Row) => { op = 'update'; patch = p; return q; },
    upsert: (p: Row) => { op = 'upsert'; patch = p; return q; },
    eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return q; },
    is: (k: string, v: unknown) => { f.push((r) => (r[k] ?? null) === v); return q; },
    in: (k: string, vs: unknown[]) => { f.push((r) => vs.includes(r[k])); return q; },
    lte: (k: string, v: string) => { f.push((r) => r[k] <= v); return q; },
    maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then: (ok: any) => ok(run()),
  };
  return q;
};

// ── fake Resend (HTTP) ──
process.env.RESEND_API_KEY = 're_test';
const sent: Array<{ to: string[]; headers?: Record<string, string>; html: string }> = [];
(globalThis as any).fetch = async (_url: string, init: any) => {
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ id: 'm1' }), { status: 200, headers: { 'content-type': 'application/json' } });
};

(async () => {
  const origLog = console.log; console.log = () => {};
  try { await sendDueDraftReminders(new Date('2026-03-01T00:00:00Z')); } finally { console.log = origLog; }
  assert.deepEqual(sent.map((m) => m.to[0]), ['in@x.co'], 'opted-out owner gets nothing; the other one gets one email');
  assert.ok(sent[0].html.includes('/api/users/email/drafts/unsubscribe?t='));
  assert.ok(sent[0].headers?.['List-Unsubscribe']?.includes('/api/users/email/drafts/unsubscribe'), 'one-click header');
  assert.ok(db.landing_pages[0].draft_warning_30d_at, 'the opted-out draft is still marked, so it is not reconsidered every sweep');

  // ── the endpoints ──
  const res = () => { const r: any = { code: 200, body: '' }; r.status = (c: number) => { r.code = c; return r; }; r.send = (b: string) => { r.body = b; return r; }; r.setHeader = () => r; return r; };
  let r = res(); draftUnsubscribePage({ query: { t: tok } } as any, r);
  assert.equal(r.code, 200); assert.match(r.body, /כן, להפסיק/);
  assert.equal(upserts.length, 0, 'opening the link changes nothing (mail scanners open links)');
  r = res(); draftUnsubscribePage({ query: { t: 'bad' } } as any, r); assert.equal(r.code, 400);
  r = res(); await draftUnsubscribeApply({ query: { t: tok } } as any, r);
  assert.equal(r.code, 200);
  assert.equal(upserts[0].email, 'a@x.co'); assert.equal(upserts[0].draft_reminders, false);
  r = res(); await draftUnsubscribeApply({ query: { t: signUnsub('a@x.co') } } as any, r);
  assert.equal(r.code, 400, 'a digest token is refused here');

  console.log('draft opt-out checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
