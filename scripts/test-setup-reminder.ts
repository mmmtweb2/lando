// Run: npx tsx scripts/test-setup-reminder.ts
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake';
import assert from 'node:assert/strict';
import { GUIDED_COPY, GUIDED_IDS } from '../client/src/dashboard/guided';
import {
  CLAIM_KEY, STALL_MAX_MS, STALL_MIN_MS, STEPS, buildReminder, isDue, nextStep, reminderEnabled, sweepReminders,
  type Mail, type Progress, type SweepDeps,
} from '../src/services/setupReminder.service';

(async () => {
  const now = new Date('2026-11-10T09:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const H = 3600_000;
  const base: Progress = { hasBusiness: true, ticks: ['first_check'], lastProgressAt: ago(72 * H), premium: false };

  // 1. the server copy of the steps matches the client (order, title, minutes)
  assert.deepEqual(STEPS.map((s) => s.id), GUIDED_IDS);
  for (const s of STEPS) { assert.equal(s.title, GUIDED_COPY[s.id].title); assert.equal(s.minutes, GUIDED_COPY[s.id].minutes); }

  // 2. next step and how many are left
  assert.deepEqual(nextStep({ hasBusiness: false, ticks: [] }), { id: 'connect', title: 'חיבור העסק', minutes: 2, left: 5 });
  assert.deepEqual(nextStep(base), { id: 'profile_details', title: 'פרטי הכרטיס שלך בגוגל', minutes: 10, left: 3 });
  assert.equal(nextStep({ hasBusiness: true, ticks: ['first_check', 'profile_details', 'profile_verified', 'review_link_shared'] }), null);
  assert.equal(nextStep({ hasBusiness: true, ticks: ['phase2_ack', 'tracking_ready'] })!.id, 'first_check', 'old keys do not count as setup steps');

  // 3. due only after 48h of silence, and not for old accounts (flag switched on late)
  assert.equal(isDue({ ...base, lastProgressAt: ago(47 * H) }, now), false);
  assert.equal(isDue({ ...base, lastProgressAt: ago(STALL_MIN_MS) }, now), true);
  assert.equal(isDue({ ...base, lastProgressAt: ago(STALL_MAX_MS) }, now), true);
  assert.equal(isDue({ ...base, lastProgressAt: ago(STALL_MAX_MS + H) }, now), false);
  assert.equal(isDue({ ...base, lastProgressAt: null }, now), false, 'unknown activity: never remind');
  assert.equal(isDue({ ...base, premium: true }, now), false, 'manual premium is handled personally');
  assert.equal(isDue({ hasBusiness: true, ticks: ['first_check', 'profile_details', 'profile_verified', 'review_link_shared'], lastProgressAt: ago(72 * H), premium: false }, now), false, 'finished setup');

  // 4. the email: next step, minutes, link to the dashboard, unsubscribe, no promises
  const mail = buildReminder(nextStep(base)!, 'https://x.test/unsub?t=1');
  assert.match(mail.subject, /פרטי הכרטיס שלך בגוגל/);
  assert.match(mail.text, /נשארו 3 צעדים מתוך 5/);
  assert.match(mail.text, /10 דקות/);
  assert.match(mail.text, /\/dashboard/);
  assert.match(mail.text, /unsub\?t=1/);
  assert.match(mail.html, /להמשך ההקמה/);
  assert.match(mail.html, /unsub\?t=1/);
  assert.match(buildReminder({ id: 'x', title: 'צעד', minutes: 1, left: 1 }, 'u').text, /נשאר צעד אחד מתוך 5/);
  for (const bad of ['מובטח', 'מבטיח', 'ראשון בגוגל', 'דירוג', 'מבטיחים', 'חייבים', 'אחרון']) assert.ok(!mail.text.includes(bad), bad);
  assert.equal(buildReminder({ id: 'x', title: '<b>x</b>', minutes: 1, left: 1 }, 'u').html.includes('<b>x</b>'), false, 'html is escaped');

  // 5. the flag: off by default, needs DIGEST_SECRET too
  delete process.env.SETUP_REMINDER_ENABLED; delete process.env.DIGEST_SECRET;
  assert.equal(reminderEnabled(), false);
  process.env.SETUP_REMINDER_ENABLED = 'true';
  assert.equal(reminderEnabled(), false, 'no secret, no unsubscribe link, no email');
  process.env.DIGEST_SECRET = 'test-secret';
  assert.equal(reminderEnabled(), true);

  // 6. sweep with fakes
  const claims = new Set<string>(); const sent: Mail[] = []; let failNext = false;
  const accounts: Record<string, Progress> = {
    'due@x.co': base,
    'fresh@x.co': { ...base, lastProgressAt: ago(5 * H) },
    'premium@x.co': { ...base, premium: true },
    'old@x.co': { ...base, lastProgressAt: ago(30 * 24 * H) },
    'done@x.co': { hasBusiness: true, ticks: ['first_check', 'profile_details', 'profile_verified', 'review_link_shared'], lastProgressAt: ago(72 * H), premium: false },
  };
  const deps: SweepDeps = {
    recipients: async () => Object.keys(accounts),
    progress: async (e) => accounts[e],
    claim: async (e) => (claims.has(e) ? false : (claims.add(e), true)),
    release: async (e) => { claims.delete(e); },
    send: async (m) => { if (failNext) throw new Error('boom'); sent.push(m); },
  };
  let r = await sweepReminders(now, deps);
  assert.deepEqual(r, { sent: 1, skipped: 4, failed: 0 });
  assert.deepEqual(sent.map((m) => m.to), ['due@x.co']);
  assert.ok(sent[0].unsub.includes('/api/seo/digest/unsubscribe?t='));
  assert.ok(claims.has('due@x.co') && claims.size === 1, 'only the sent account is claimed');

  // 7. a second sweep never mails the same account again
  r = await sweepReminders(new Date(now.getTime() + 6 * H), deps);
  assert.equal(r.sent, 0);
  assert.equal(sent.length, 1);

  // 8. a failed send releases the claim so the next sweep retries
  claims.clear(); sent.length = 0; failNext = true;
  r = await sweepReminders(now, deps);
  assert.deepEqual([r.sent, r.failed], [0, 1]);
  assert.equal(claims.size, 0, 'claim released after a failed send');
  failNext = false;
  r = await sweepReminders(now, deps);
  assert.equal(r.sent, 1);

  // 9. flag off: nothing is read or sent
  process.env.SETUP_REMINDER_ENABLED = 'false'; claims.clear(); sent.length = 0;
  let touched = false;
  r = await sweepReminders(now, { ...deps, recipients: async () => { touched = true; return ['due@x.co']; } });
  assert.deepEqual(r, { sent: 0, skipped: 0, failed: 0 });
  assert.equal(touched, false);
  assert.equal(CLAIM_KEY, 'setup-reminder');

  console.log('setup reminder checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
