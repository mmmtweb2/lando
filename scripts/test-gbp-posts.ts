// Weekly Google posts: week keys, quiet hours, topics, text checks and the sweep. No network, no database.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'assert';
import { emptyCard, type TruthCard } from '../src/services/businessTruth';
import { GbpError } from '../src/services/gbpGoogle';
import { cleanPost, ctaFor, fallbackPost, israelTime, nextOpenTime, pickTopic, postPrompt, publishAfter, quietNow, topicsOf, weekKey } from '../src/services/gbpPosts';
import { ownerText, sweepPosts, writePost, type PostRow, type SweepDeps } from '../src/services/gbpPosts.service';

const card: TruthCard = {
  ...emptyCard(), name: 'אינסטלציה דני', phone: '03-5551234', category: 'אינסטלטור', city: 'גבעתיים',
  services: [{ name: 'תיקון נזילות', description: 'איתור ותיקון נזילות בבית', source: 'google' }, { name: 'פתיחת סתימות', description: '', source: 'customer' }],
  areas: ['גבעתיים', 'רמת גן'], description: 'אינסטלטור מוסמך עם זמינות גם בערב.', hours: [{ day: 'SUNDAY', open: '08:00', close: '18:00' }],
};
const GOOD = 'נזילה קטנה מתחת לכיור יכולה להפוך תוך כמה ימים לכתם רטיבות בקיר. אצלנו מאתרים את מקור הנזילה ומתקנים אותו במקום, בגבעתיים וברמת גן. רואים טיפה שלא אמורה להיות שם? דברו איתנו ונגיע לבדוק.';

(async () => {
  // ── weeks and quiet hours ──
  assert.equal(weekKey(new Date('2026-11-10T10:00:00Z')), '2026-W46');
  assert.equal(weekKey(new Date('2026-11-15T23:00:00Z')), '2026-W46', 'Sunday closes the ISO week');
  assert.equal(weekKey(new Date('2026-11-16T00:00:00Z')), '2026-W47');
  assert.equal(weekKey(new Date('2027-01-01T12:00:00Z')), '2026-W53', 'the first days of January can belong to the old year');
  assert.deepEqual(israelTime(new Date('2026-11-10T10:00:00Z')), { dow: 2, hour: 12 }, 'Tuesday noon in Israel (UTC+2 in winter)');
  assert.deepEqual(israelTime(new Date('2026-07-10T10:00:00Z')), { dow: 5, hour: 13 }, 'UTC+3 in summer');
  assert.equal(quietNow(new Date('2026-11-10T10:00:00Z')), false, 'a weekday at noon');
  assert.equal(quietNow(new Date('2026-11-13T11:00:00Z')), false, 'Friday 13:00');
  assert.equal(quietNow(new Date('2026-11-13T12:00:00Z')), true, 'Friday 14:00: Shabbat is coming in');
  assert.equal(quietNow(new Date('2026-11-14T10:00:00Z')), true, 'Saturday noon');
  assert.equal(quietNow(new Date('2026-11-14T19:30:00Z')), true, 'Saturday 21:30: Shabbat is out but it is night; Sunday morning is the next slot');
  assert.equal(quietNow(new Date('2026-11-11T02:00:00Z')), true, '04:00 at night');
  assert.equal(quietNow(new Date('2026-11-11T06:30:00Z')), false, '08:30 in the morning');
  assert.equal(nextOpenTime(new Date('2026-11-10T10:00:00Z')).toISOString(), '2026-11-10T10:00:00.000Z', 'an open time stays as it is');
  assert.equal(nextOpenTime(new Date('2026-11-13T13:47:00Z')).toISOString(), '2026-11-15T06:00:00.000Z', 'Friday afternoon becomes Sunday 08:00 in Israel');
  assert.equal(nextOpenTime(new Date('2026-11-11T01:10:00Z')).toISOString(), '2026-11-11T06:00:00.000Z', 'night becomes the same morning');
  assert.equal(publishAfter(new Date('2026-11-10T10:00:00Z')).toISOString(), '2026-11-12T10:00:00.000Z', '48 hours to read and edit');

  // ── topics ──
  assert.deepEqual(topicsOf(card).map((t) => t.key), ['service:תיקון נזילות', 'service:פתיחת סתימות', 'about', 'area:גבעתיים', 'area:רמת גן', 'hours']);
  assert.equal(pickTopic(card, [])!.key, 'service:תיקון נזילות', 'nothing posted yet: the first service');
  assert.equal(pickTopic(card, ['service:תיקון נזילות'])!.key, 'service:פתיחת סתימות', 'a topic never used comes before one that was');
  const all = topicsOf(card).map((t) => t.key);
  assert.equal(pickTopic(card, [...all].reverse())!.key, all[0], 'everything used: the one used longest ago');
  assert.equal(pickTopic(emptyCard(), []), null, 'an empty card has nothing to post about');
  assert.equal(ctaFor(card), 'CALL');
  assert.equal(ctaFor({ ...card, phone: '', website: 'https://a.co' }), 'LEARN_MORE');
  assert.equal(ctaFor({ ...card, phone: '' }), null);

  // ── text checks ──
  assert.equal(cleanPost(GOOD, card), GOOD);
  assert.equal(cleanPost(`**${GOOD}**`, card), GOOD, 'markdown removed');
  assert.equal(cleanPost(`"${GOOD}"`, card), GOOD, 'wrapping quotes removed');
  assert.equal(cleanPost(`${GOOD} https://spam.example`, card), null, 'a link');
  assert.equal(cleanPost(`${GOOD} התקשרו 050-9999999`, card), null, 'a phone number that is not the business\'s');
  assert.ok(cleanPost(`${GOOD} התקשרו 03-5551234`, card), 'the business\'s own number is allowed');
  assert.equal(cleanPost(`${GOOD} אנחנו הכי טובים באזור.`, card), null, 'a boast');
  assert.equal(cleanPost(`${GOOD} התוצאה מובטחת.`, card), null, 'a promise');
  const priced = cleanPost(`${GOOD} מחיר ביקור 150 שקלים בלבד.`, card);
  assert.ok(priced && !priced.includes('150'), 'a sentence with a number that is not in the card is dropped');
  assert.equal(cleanPost('קצר מדי.', card), null);
  assert.equal(cleanPost(7, card), null);
  const long = cleanPost(`${GOOD} `.repeat(8), card)!;
  assert.ok(long.length <= 900 && /[.!?]$/.test(long), 'a long text is cut at the end of a sentence');
  for (const t of topicsOf(card)) {
    const fb = cleanPost(fallbackPost(card, t), card);
    assert.ok(fb && fb.includes('אינסטלציה דני'), `the plain text for "${t.key}" passes its own checks`);
  }
  const p = postPrompt(card, topicsOf(card)[0], ['פוסט קודם']);
  assert.ok(p.includes('<data>') && p.includes('תיקון נזילות') && p.includes('פוסט קודם'));
  assert.equal(ownerText('  טקסט של בעל העסק, עם מחיר: 150 שקלים.  '), 'טקסט של בעל העסק, עם מחיר: 150 שקלים.', 'the owner\'s own numbers are theirs');
  assert.equal(ownerText('קצר'), null);
  assert.equal(ownerText('בואו לאתר שלנו www.spam.example עכשיו'), null);

  // ── writing ──
  assert.deepEqual(await writePost(card, [], async () => GOOD), { topic: 'service:תיקון נזילות', body: GOOD });
  const viaFallback = await writePost(card, [], async () => 'אנחנו הכי טובים! https://x.co');
  assert.ok(viaFallback && viaFallback.body.includes('תיקון נזילות') && !viaFallback.body.includes('הכי'), 'a text that fails the checks is replaced by the plain one');
  assert.ok((await writePost(card, [], async () => { throw new Error('model down'); }))!.body.length > 80, 'a failing model does not stop the week');
  assert.ok((await writePost(card, [], async () => null))!.body.length > 80, 'no AI key: the plain text');
  assert.equal(await writePost(emptyCard(), [], async () => GOOD), null);

  // ── the sweep ──
  process.env.AUTOPILOT_ENABLED = 'true';
  const NOW = new Date('2026-11-10T10:00:00Z');
  let rows: PostRow[] = [];
  const log: string[] = [];
  let sendFail: Error | null = null;
  let mode: 'auto' | 'approve' | 'off' = 'auto';
  const sent: string[] = [];
  const sentBodies: string[] = [];
  let finishFail = 0;
  let clock = NOW;
  const deps: SweepDeps = {
    accounts: async () => ['a@x.co'],
    context: async (email) => ({ card, location: 'locations/1', mode, recent: rows.filter((r) => r.owner_email === email).sort((a, b) => b.created_at.localeCompare(a.created_at)) }),
    write: async () => GOOD,
    create: async (r) => {
      if (rows.some((x) => x.owner_email === r.owner_email && x.week_key === r.week_key)) return null;
      const row: PostRow = { id: `p${rows.length + 1}`, status: 'scheduled', edited: false, approved: false, published_at: null, attempts: 0, last_error: null, created_at: clock.toISOString(), ...r };
      rows.push(row); return row;
    },
    due: async (email, now) => rows.filter((r) => r.owner_email === email && r.status === 'scheduled' && r.publish_after <= now.toISOString()),
    claim: async (id) => { const r = rows.find((x) => x.id === id)!; if (r.status !== 'scheduled') return null; r.status = 'publishing'; return { ...r }; },
    send: async (_e, r) => { if (sendFail) throw sendFail; sent.push(r.id); sentBodies.push(r.body); return `accounts/1/locations/1/localPosts/${r.id}`; },
    finish: async (id, patch) => { if (finishFail > 0) { finishFail--; throw new Error('db down'); } Object.assign(rows.find((x) => x.id === id)!, patch); },
    tidy: async (email, location, keepId, now) => {
      for (const r of rows) {
        if (r.owner_email !== email || r.status !== 'scheduled') continue;
        const stale = !r.approved && r.created_at < new Date(now.getTime() - 14 * 86_400_000).toISOString();
        if (r.location_name !== location || stale || (keepId && !r.approved && r.id !== keepId)) r.status = 'skipped';
      }
    },
    log: async (_e, kind) => { log.push(kind); },
  };

  const run = (at: Date | string, d: SweepDeps = deps) => { clock = new Date(at); return sweepPosts(clock, d); };
  let res = await run(NOW);
  assert.deepEqual(res, { accounts: 1, planned: 1, published: 0, waiting: 0, failed: 0 }, 'the week\'s post is written and waits 48 hours');
  assert.equal(rows[0].publish_after, '2026-11-12T10:00:00.000Z');
  assert.equal(rows[0].cta, 'CALL');
  res = await run('2026-11-11T10:00:00Z', deps);
  assert.deepEqual([res.planned, res.published], [0, 0], 'same week, not due: nothing happens');
  assert.equal(rows.length, 1);

  res = await run('2026-11-12T10:30:00Z', deps);
  assert.equal(res.published, 1, 'due, auto mode, a weekday at noon: published');
  assert.deepEqual(sent, ['p1']);
  assert.equal(rows[0].status, 'published');
  assert.deepEqual(log, ['post_planned', 'post_published']);
  res = await run('2026-11-12T13:30:00Z', deps);
  assert.equal(res.published, 0, 'a published post is never sent twice');
  assert.equal(sent.length, 1);

  // Shabbat: a post that falls due on Saturday waits for Sunday.
  rows = []; sent.length = 0;
  await run('2026-11-12T08:00:00Z', deps);                 // Thursday -> due Saturday 10:00 Israel
  res = await run('2026-11-14T09:00:00Z', deps);
  assert.deepEqual([res.published, res.waiting], [0, 1], 'nothing is published by us on Shabbat');
  res = await run('2026-11-15T07:00:00Z', deps);           // Sunday 09:00 Israel
  assert.equal(res.published, 1);
  assert.equal(rows.length, 1, 'still W46: no second post');

  // "approve" mode: nothing goes out without the owner.
  rows = []; sent.length = 0; mode = 'approve';
  await run(NOW, deps);
  res = await run('2026-11-12T10:30:00Z', deps);
  assert.deepEqual([res.published, res.waiting], [0, 1]);
  rows[0].approved = true;                                                   // the owner pressed publish while Google was unavailable
  res = await run('2026-11-12T13:30:00Z', deps);
  assert.equal(res.published, 1, 'an owner-approved post goes out on the next sweep');
  rows = []; await run(NOW, deps);
  await run('2026-11-30T10:30:00Z', deps);
  assert.equal(rows[0].status, 'skipped', 'a post nobody approved for two weeks stops waiting');
  assert.equal(rows.length, 2, 'and the new week gets its own post');

  // "off": nothing is written.
  rows = []; mode = 'off';
  res = await run(NOW, deps);
  assert.deepEqual([res.planned, rows.length], [0, 0]);

  // Google quota not open yet: the post stays scheduled, no attempt is counted.
  rows = []; sent.length = 0; mode = 'auto';
  await run(NOW, deps);
  sendFail = new GbpError('google', 'post:http_429:RESOURCE_EXHAUSTED');
  res = await run('2026-11-12T10:30:00Z', deps);
  assert.deepEqual([res.waiting, res.failed], [1, 0]);
  assert.deepEqual([rows[0].status, rows[0].attempts, rows[0].last_error], ['scheduled', 0, 'google quota pending']);
  // A real failure: retried, then given up after three attempts.
  sendFail = new GbpError('google', 'post:http_400:INVALID_ARGUMENT');
  for (const at of ['2026-11-12T16:30:00Z', '2026-11-13T07:00:00Z', '2026-11-15T08:00:00Z']) res = await run(at);
  assert.deepEqual([rows[0].status, rows[0].attempts], ['failed', 3]);
  // A revoked connection fails at once (the customer has to reconnect).
  rows = []; await run(NOW, deps);
  sendFail = new GbpError('revoked');
  await run('2026-11-12T10:30:00Z', deps);
  assert.equal(rows[0].status, 'failed');

  // Google accepted the post but our database write failed: the post is NOT sent again.
  rows = []; sendFail = null; sent.length = 0;
  await run(NOW);
  finishFail = 5;
  res = await run('2026-11-12T10:30:00Z');
  assert.equal(sent.length, 1);
  assert.equal(rows[0].status, 'publishing', 'left as publishing, which no sweep re-sends');
  finishFail = 0;
  await run('2026-11-12T13:30:00Z'); await run('2026-11-15T08:00:00Z');
  assert.equal(sent.length, 1, 'never a second copy on the customer\'s profile');

  // The quota opens after weeks of waiting: one post goes out, not the whole backlog.
  rows = []; sent.length = 0; sendFail = new GbpError('google', 'post:http_429:RESOURCE_EXHAUSTED');
  for (const at of ['2026-11-10T10:00:00Z', '2026-11-12T10:30:00Z', '2026-11-17T10:00:00Z', '2026-11-19T10:30:00Z', '2026-11-24T10:00:00Z']) await run(at);
  assert.equal(rows.length, 3, 'three weeks, three posts written');
  assert.deepEqual(rows.map((r) => r.status), ['skipped', 'skipped', 'scheduled'], 'each new weekly post replaces the one still waiting');
  sendFail = null;
  res = await run('2026-11-26T10:30:00Z');
  assert.deepEqual([res.published, sent.length], [1, 1]);
  assert.equal(sent[0], rows[2].id, 'the newest one');

  // The owner edits just before publishing: the text that goes out is the edited one.
  rows = []; sent.length = 0; sentBodies.length = 0;
  await run(NOW);
  const editing: SweepDeps = { ...deps, due: async (e, n) => { const d = await deps.due(e, n); rows[0].body = 'הנוסח של בעל העסק, אחרי עריכה של הרגע האחרון.'; return d.map((x) => ({ ...x, body: 'OLD' })); } };
  await run('2026-11-12T10:30:00Z', editing);
  assert.deepEqual(sentBodies, ['הנוסח של בעל העסק, אחרי עריכה של הרגע האחרון.']);

  // The customer connected a different business: a post written for the old one is dropped, never sent.
  rows = []; sent.length = 0;
  await run(NOW);
  const moved: SweepDeps = { ...deps, context: async (e) => ({ ...(await deps.context(e))!, location: 'locations/2' }) };
  res = await run('2026-11-12T10:30:00Z', moved);
  assert.deepEqual([sent.length, rows[0].status], [0, 'skipped']);

  // One account crashing does not stop the others.
  rows = []; sendFail = null; sent.length = 0;
  const two: SweepDeps = { ...deps, accounts: async () => ['bad@x.co', 'a@x.co'], context: async (e) => { if (e === 'bad@x.co') throw new Error('db down'); return deps.context(e); } };
  res = await run(NOW, two);
  assert.deepEqual([res.accounts, res.failed, res.planned], [2, 1, 1]);

  // The operator switch.
  process.env.AUTOPILOT_ENABLED = 'false';
  rows = [];
  assert.deepEqual(await run(NOW, deps), { accounts: 0, planned: 0, published: 0, waiting: 0, failed: 0 });
  assert.equal(rows.length, 0, 'switched off: nothing is written or published');

  console.log('gbp posts: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
