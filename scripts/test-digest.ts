// Run: npx ts-node --transpile-only scripts/test-digest.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import { unsubscribeApply, unsubscribePage } from '../src/controllers/digest.controller';
import {
  bounds, buildDigest, digestEnabled, inSendWindow, signUnsub, suggestion, sweepDigests, unsubUrl, verifyUnsub,
  type DigestStats, type Mail, type SweepDeps,
} from '../src/services/digest.service';
import { supabase } from '../src/config/supabase';

process.env.DIGEST_SECRET = 'test-secret-123';

// ── months (Israel time) ──
const b = bounds(new Date('2026-12-03T10:00:00Z'));
assert.equal(b.monthKey, '2026-12'); assert.equal(b.dayOfMonth, 3);
assert.equal(b.prevStart.toISOString(), '2026-10-31T22:00:00.000Z', 'Nov 1 00:00 Israel (UTC+2)');
assert.equal(b.prevEnd.toISOString(), '2026-11-30T22:00:00.000Z');
assert.equal(b.prevLabel, 'נובמבר');
const jan = bounds(new Date('2027-01-04T10:00:00Z')); assert.equal(jan.monthKey, '2027-01'); assert.equal(jan.prevLabel, 'דצמבר');
assert.equal(jan.beforeStart.toISOString(), '2026-10-31T22:00:00.000Z', 'wraps over the year');
assert.equal(inSendWindow(new Date('2026-12-01T10:00:00Z')), false, 'day 1: month just ended, wait for late events');
assert.equal(inSendWindow(new Date('2026-12-02T10:00:00Z')), true);
assert.equal(inSendWindow(new Date('2026-12-07T10:00:00Z')), true);
assert.equal(inSendWindow(new Date('2026-12-08T10:00:00Z')), false);

// ── unsubscribe token ──
const tok = signUnsub('a@x.co');
assert.equal(verifyUnsub(tok), 'a@x.co');
assert.equal(verifyUnsub(tok.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))), null, 'tampered mac');
assert.equal(verifyUnsub(signUnsub('b@x.co').split('.')[0] + '.' + tok.split('.')[1]), null, 'mac of another email');
assert.equal(verifyUnsub(tok, 'other-secret'), null); assert.equal(verifyUnsub(undefined), null); assert.equal(verifyUnsub('x'), null);
assert.ok(unsubUrl('a@x.co').includes('/api/seo/digest/unsubscribe?t='));

// ── content ──
const st = (o: Partial<DigestStats> = {}): DigestStats => ({ businessName: 'קפה <נעמי>', prevLabel: 'נובמבר', inquiries: 7, inquiriesBefore: 4, reviewAsks: 3, ...o });
assert.match(suggestion(st({ businessName: null })), /חברו את העסק/);
assert.match(suggestion(st({ inquiries: 0 })), /עוד לא נספרו/);
assert.match(suggestion(st({ reviewAsks: 0 })), /ביקורת/);
assert.match(suggestion(st({ inquiries: 2, inquiriesBefore: 9 })), /ירדו/);
assert.match(suggestion(st()), /ממשיכים/);
const m = buildDigest(st(), 'https://x.co/u?t=1');
assert.ok(m.subject.includes('נובמבר') && m.subject.includes('7 פניות'));
assert.ok(m.html.includes('3 בקשות ביקורת') && m.html.includes('3 פניות יותר'));
assert.ok(m.html.includes('href="https://x.co/u?t=1"') && m.text.includes('https://x.co/u?t=1'), 'unsubscribe link in html and text');
assert.ok(!m.html.includes('<נעמי>') && m.html.includes('&lt;נעמי&gt;'), 'business name escaped');
assert.ok(buildDigest(st({ inquiries: 1 }), 'u').subject.includes('פנייה אחת'));
assert.ok(buildDigest(st({ inquiries: 0, inquiriesBefore: 0 }), 'u').html.includes('0'));

// ── sweep: switch, window, once per month, failure releases the claim ──
(async () => {
  const claimed = new Set<string>(); const sent: Mail[] = []; let failFor: string | null = null;
  const deps: SweepDeps = {
    recipients: async () => ['a@x.co', 'b@x.co', 'c@x.co'],
    claim: async (e, mo) => { const k = e + mo; if (claimed.has(k)) return false; claimed.add(k); return true; },
    release: async (e, mo) => { claimed.delete(e + mo); },
    stats: async () => st(),
    send: async (mail) => { if (mail.to === failFor) throw new Error('smtp down'); sent.push(mail); },
  };
  const inWindow = new Date('2026-12-03T10:00:00Z');

  delete process.env.MONTHLY_DIGEST_ENABLED; assert.equal(digestEnabled(), false);
  assert.deepEqual(await sweepDigests(inWindow, deps), { sent: 0, skipped: 0, failed: 0 }); assert.equal(sent.length, 0, 'off by default');
  process.env.MONTHLY_DIGEST_ENABLED = 'true'; assert.equal(digestEnabled(), true);
  const secret = process.env.DIGEST_SECRET; delete process.env.DIGEST_SECRET; assert.equal(digestEnabled(), false, 'needs the secret'); process.env.DIGEST_SECRET = secret;
  assert.deepEqual(await sweepDigests(new Date('2026-12-20T10:00:00Z'), deps), { sent: 0, skipped: 0, failed: 0 }); assert.equal(sent.length, 0, 'outside the window');

  failFor = 'b@x.co';
  assert.deepEqual(await sweepDigests(inWindow, deps), { sent: 2, skipped: 0, failed: 1 });
  assert.deepEqual(sent.map((s) => s.to), ['a@x.co', 'c@x.co']);
  assert.ok(sent.every((s) => verifyUnsub(new URL(s.unsub).searchParams.get('t')) === s.to), 'each mail has its own valid unsubscribe link');
  failFor = null;
  assert.deepEqual(await sweepDigests(inWindow, deps), { sent: 1, skipped: 2, failed: 0 }, 'only the failed one is retried; nobody gets two');
  assert.deepEqual(await sweepDigests(inWindow, deps), { sent: 0, skipped: 3, failed: 0 });
  assert.deepEqual(await sweepDigests(new Date('2027-01-03T10:00:00Z'), deps), { sent: 3, skipped: 0, failed: 0 }, 'next month sends again');

  // ── unsubscribe endpoints ──
  const prefs: any[] = [];
  (supabase as any).from = (t: string) => { assert.equal(t, 'seo_email_prefs'); return { upsert: (r: any) => { prefs.push(r); return Promise.resolve({ error: null }); } }; };
  const res = () => { const r: any = { code: 200, body: '', headers: {} }; r.status = (c: number) => { r.code = c; return r; }; r.send = (b: string) => { r.body = b; return r; }; r.setHeader = (k: string, v: string) => { r.headers[k] = v; }; return r; };
  let r = res(); unsubscribePage({ query: { t: 'garbage' } } as any, r); assert.equal(r.code, 400);
  r = res(); unsubscribePage({ query: { t: signUnsub('a@x.co') } } as any, r); assert.equal(r.code, 200); assert.ok(r.body.includes('<form method="post"'));
  assert.equal(prefs.length, 0, 'opening the link changes nothing');
  r = res(); await unsubscribeApply({ query: { t: 'garbage' } } as any, r); assert.equal(r.code, 400); assert.equal(prefs.length, 0);
  r = res(); await unsubscribeApply({ query: { t: signUnsub('a@x.co') } } as any, r); assert.equal(r.code, 200);
  assert.deepEqual([prefs[0].email, prefs[0].monthly_digest], ['a@x.co', false]);

  console.log('digest checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
