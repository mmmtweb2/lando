// Unanswered-review alerts: Google review parsing, candidates, drafts, idempotent sweep. No network.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
import assert from 'assert';
import { GbpError, listReviews, parseReviews, postReply } from '../src/services/gbpGoogle';
import {
  buildAlertEmail, candidates, draftReply, firstName, sweepReviewAlerts, validReplyText, type DraftRow, type NewDraft, type SweepDeps,
} from '../src/services/reviewAlerts.service';

const NOW = new Date('2026-11-10T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const rv = (id: string, rating: number, age: number, extra: Record<string, unknown> = {}) => ({
  reviewId: id, starRating: ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'][rating], createTime: daysAgo(age), comment: 'טקסט', reviewer: { displayName: 'דנה כהן' }, ...extra,
});

(async () => {
  // ── parsing Google's response ──
  const parsed = parseReviews({ reviews: [
    rv('rev-aaaaa', 5, 6),
    rv('rev-bbbbb', 2, 8, { reviewReply: { comment: 'תודה', updateTime: daysAgo(7) } }),
    rv('rev-ccccc', 4, 10, { reviewer: { isAnonymous: true, displayName: 'A Google User' } }),
    { reviewId: 'x', starRating: 'FIVE', createTime: daysAgo(1) },        // id too short
    { reviewId: 'rev-ddddd', starRating: 'ZERO', createTime: daysAgo(1) },  // unknown rating
    { reviewId: 'rev-eeeee', starRating: 'FIVE', createTime: 'garbage' },   // bad date
    null, 7,
  ] });
  assert.deepEqual(parsed.map(r => r.id), ['rev-aaaaa', 'rev-bbbbb', 'rev-ccccc']);
  assert.equal(parsed[1].hasReply, true);
  assert.equal(parsed[0].hasReply, false);
  assert.equal(parsed[2].reviewer, null, 'anonymous reviewer has no name');
  assert.deepEqual(parseReviews({}), []);
  assert.deepEqual(parseReviews(undefined), []);

  // ── Google calls (fake fetch) ──
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mk = (status: number, body: unknown) => (async (url: any, init?: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;
  const list = await listReviews('AT', 'accounts/1', 'locations/2', mk(200, { reviews: [rv('rev-aaaaa', 5, 6)] }));
  assert.equal(list.length, 1);
  assert.ok(calls[0].url.startsWith('https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews'));
  assert.equal((calls[0].init?.headers as any).authorization, 'Bearer AT');
  await assert.rejects(listReviews('AT', '../evil', 'locations/2', mk(200, {})), (e: any) => e instanceof GbpError);
  await assert.rejects(listReviews('AT', 'accounts/1', 'locations/2', mk(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } })), (e: any) => /http_429/.test(e.message));
  await assert.rejects(listReviews('AT', 'accounts/1', 'locations/2', mk(401, {})), (e: any) => e.code === 'revoked');
  calls.length = 0;
  await postReply('AT', 'accounts/1', 'locations/2', 'rev-aaaaa', 'תודה רבה', mk(200, {}));
  assert.equal(calls[0].init?.method, 'PUT');
  assert.ok(calls[0].url.endsWith('/reviews/rev-aaaaa/reply'));
  assert.equal(JSON.parse(String(calls[0].init?.body)).comment, 'תודה רבה');
  await assert.rejects(postReply('AT', 'accounts/1', 'locations/2', '../x', 'a', mk(200, {})), (e: any) => e instanceof GbpError);
  await assert.rejects(postReply('AT', 'accounts/1', 'locations/2', 'rev-aaaaa', 'a', mk(403, { error: { status: 'PERMISSION_DENIED' } })), (e: any) => /reply:http_403/.test(e.message));

  // ── candidates: unanswered, 5-30 days old ──
  const all = parseReviews({ reviews: [rv('rev-new11', 5, 2), rv('rev-edge1', 5, 5), rv('rev-mid11', 3, 12), rv('rev-old11', 1, 31), rv('rev-done1', 2, 9, { reviewReply: { comment: 'ok' } })] });
  assert.deepEqual(candidates(all, NOW).map(r => r.id), ['rev-edge1', 'rev-mid11'], '2 days: too new; 31 days: too old; replied: skipped');

  // ── drafts ──
  assert.equal(firstName('דנה כהן'), 'דנה');
  assert.equal(firstName('http://spam.example'), null);
  assert.equal(firstName('😀'), null);
  assert.equal(firstName(null), null);
  assert.ok(draftReply(5, 'דנה כהן', 'קפה נעמי').startsWith('שלום דנה,'));
  assert.ok(draftReply(5, null, 'קפה נעמי').startsWith('שלום,'));
  assert.ok(draftReply(1, 'דנה', 'קפה נעמי').includes('מצטערים') && draftReply(1, 'דנה', 'x').includes('ישירות'), 'low rating: apology + direct contact');
  assert.ok(!draftReply(1, 'דנה', 'x').includes('תודה רבה על הביקורת ועל המילים החמות'));
  assert.ok(draftReply(3, null, 'x').includes('להשתפר'));
  assert.equal(validReplyText('  שלום  '), 'שלום');
  assert.equal(validReplyText(''), null); assert.equal(validReplyText('a'), null); assert.equal(validReplyText(5), null);
  assert.equal(validReplyText('x'.repeat(4001)), null);
  assert.equal(validReplyText('ab\u0000c'), 'abc');

  // ── email ──
  const mail = buildAlertEmail('<b>קפה</b>', 2, 'https://x.example/u?t=1');
  assert.ok(mail.subject.includes('2 ביקורות'));
  assert.ok(!mail.html.includes('<b>קפה</b>'), 'business name is escaped');
  assert.ok(mail.html.includes('https://x.example/u?t=1') && mail.text.includes('https://x.example/u?t=1'), 'unsubscribe link in both parts');
  assert.ok(mail.text.includes('/dashboard') && !/comment|טקסט הביקורת/.test(mail.text), 'no review text in the email');
  assert.ok(buildAlertEmail('x', 1, 'u').subject.includes('ביקורת אחת'));

  // ── sweep ──
  const store = new Map<string, DraftRow & { createdAt: number }>();
  const sent: Array<{ to: string; subject: string }> = [];
  let failSend = false; let n = 0;
  const reviewsFor: Record<string, ReturnType<typeof parseReviews>> = {
    'a@x.co': parseReviews({ reviews: [rv('rev-aaaa1', 5, 6), rv('rev-aaaa2', 2, 9), rv('rev-aaaa3', 4, 1)] }),
    'b@x.co': [],
  };
  const deps: SweepDeps = {
    accounts: async () => ['a@x.co', 'b@x.co', 'quota@x.co'],
    fetchReviews: async (email) => {
      if (email === 'quota@x.co') throw new GbpError('google', 'reviews:http_429:RESOURCE_EXHAUSTED:Quota');
      return { reviews: reviewsFor[email], location: 'locations/9', business: 'קפה נעמי' };
    },
    claim: async (rows: NewDraft[]) => {
      const made: DraftRow[] = [];
      for (const r of rows) {
        const key = `${r.owner_email}|${r.review_id}`;
        if (store.has(key)) continue;
        const row = { ...r, id: `id-${++n}`, status: 'pending' as const, notified_at: null, createdAt: NOW.getTime() };
        store.set(key, row); made.push(row);
      }
      return made;
    },
    unnotified: async (email) => [...store.values()].filter(r => r.owner_email === email && r.status === 'pending' && !r.notified_at),
    send: async (to, m) => { if (failSend) throw new Error('resend down'); sent.push({ to, subject: m.subject }); },
    markNotified: async (ids, now) => { for (const r of store.values()) if (ids.includes(r.id)) r.notified_at = now.toISOString(); },
  };

  // Off by default.
  let r0 = await sweepReviewAlerts(NOW, deps);
  assert.deepEqual(r0, { accounts: 0, drafted: 0, emailed: 0, failed: 0 }, 'does nothing unless enabled');
  process.env.ALERTS_ENABLED = 'true'; process.env.DIGEST_SECRET = 'secret'; process.env.RESEND_API_KEY = 're_fake';
  process.env.ALERTS_ENABLED = 'false';
  assert.equal((await sweepReviewAlerts(NOW, deps)).accounts, 0, 'ALERTS_ENABLED=false → nothing');
  process.env.ALERTS_ENABLED = 'true';
  delete process.env.DIGEST_SECRET;
  assert.equal((await sweepReviewAlerts(NOW, deps)).accounts, 0, 'no DIGEST_SECRET (no unsubscribe link) → nothing');
  process.env.DIGEST_SECRET = 'secret';

  const r1 = await sweepReviewAlerts(NOW, deps);
  assert.deepEqual(r1, { accounts: 3, drafted: 2, emailed: 1, failed: 1 }, 'a: 2 drafts + 1 email; quota account fails alone');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'a@x.co');
  assert.ok(sent[0].subject.includes('2 ביקורות'));
  const r2 = await sweepReviewAlerts(NOW, deps);
  assert.deepEqual([r2.drafted, r2.emailed], [0, 0], 'second sweep: same reviews are not alerted again');
  assert.equal(sent.length, 1);

  // A failed email is retried and does not create duplicate drafts.
  reviewsFor['b@x.co'] = parseReviews({ reviews: [rv('rev-bbbb1', 3, 7)] });
  failSend = true;
  const r3 = await sweepReviewAlerts(NOW, deps);
  assert.equal(r3.drafted, 1); assert.equal(r3.emailed, 0); assert.ok(r3.failed >= 1);
  failSend = false;
  const r4 = await sweepReviewAlerts(NOW, deps);
  assert.equal(r4.drafted, 0, 'no duplicate draft on retry');
  assert.equal(r4.emailed, 1, 'the email goes out on the retry');
  assert.equal(sent.filter(s => s.to === 'b@x.co').length, 1);

  // More than 5 new reviews in one sweep: only 5 drafts for the account.
  reviewsFor['a@x.co'] = parseReviews({ reviews: Array.from({ length: 9 }, (_, i) => rv(`rev-many${i}1`, 5, 6 + i)) });
  const r5 = await sweepReviewAlerts(NOW, deps);
  assert.equal(r5.drafted, 5, 'capped per account');

  console.log('review alert checks passed');
})().catch(e => { console.error(e); process.exit(1); });
