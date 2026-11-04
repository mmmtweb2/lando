// ONE reminder email to a customer who stopped in the middle of the guided setup (spec v4, point 7).
// OFF unless SETUP_REMINDER_ENABLED=true (and DIGEST_SECRET exists, for the unsubscribe link). It is
// switched on only after the legal review of marketing emails.
//
// Who gets it: an account that holds the product, has not unsubscribed (the same switch as the
// monthly summary), is not a manual-premium customer (we handle those personally), has not finished
// the five steps, and made no progress for 48 hours. "Progress" = the business was connected, a
// step was ticked, or the product was activated. To avoid mailing old accounts when the flag is
// first switched on, only a stall of 2 to 7 days counts.
// The (email, 'setup-reminder') row in seo_digest_log is claimed BEFORE sending, so a restart or a
// second instance can never send it twice, and the claim is never released after a successful send:
// one reminder per account, ever. A failed send releases the claim for the next sweep.
// The email links to /dashboard, where the guided setup opens on the next open step by itself.

import { Resend } from 'resend';
import { supabase } from '../config/supabase';
import { withHeartbeat } from './opsMetrics.service';
import { listRecipients, unsubUrl } from './digest.service';

const APP_URL = (process.env.PUBLIC_APP_URL || 'https://pagey.co.il').replace(/\/$/, '');
const HOUR = 3600_000;
export const STALL_MIN_MS = 48 * HOUR;
export const STALL_MAX_MS = 7 * 24 * HOUR;
const SWEEP_EVERY_MS = 6 * HOUR;
const MAX_PER_SWEEP = 50;
export const CLAIM_KEY = 'setup-reminder';

export function reminderEnabled(): boolean {
  return process.env.SETUP_REMINDER_ENABLED === 'true' && !!process.env.DIGEST_SECRET;
}

/** Mirrors client/src/dashboard/guided.ts (order, titles, minutes). scripts/test-setup-reminder.ts compares the two. */
export const STEPS = [
  { id: 'connect', title: 'חיבור העסק', minutes: 2 },
  { id: 'first_check', title: 'בדיקה ראשונה מול מתחרים', minutes: 1 },
  { id: 'profile_details', title: 'פרטי הכרטיס שלך בגוגל', minutes: 10 },
  { id: 'profile_verified', title: 'אימות הכרטיס', minutes: 5 },
  { id: 'review_link_shared', title: 'בקשת ביקורת ראשונה', minutes: 3 },
] as const;

export interface Progress {
  hasBusiness: boolean;
  /** setup ticks the customer saved (seo_setup_steps keys) */
  ticks: string[];
  /** the latest sign of progress; null = unknown, never remind */
  lastProgressAt: Date | null;
  premium: boolean;
}

export interface NextStep { id: string; title: string; minutes: number; left: number }

export function nextStep(p: Pick<Progress, 'hasBusiness' | 'ticks'>): NextStep | null {
  const open = STEPS.filter((s) => (s.id === 'connect' ? !p.hasBusiness : !p.ticks.includes(s.id)));
  const first = open[0];
  return first ? { id: first.id, title: first.title, minutes: first.minutes, left: open.length } : null;
}

export function isDue(p: Progress, now: Date): boolean {
  if (p.premium || !p.lastProgressAt) return false;
  if (!nextStep(p)) return false;
  const stalled = now.getTime() - p.lastProgressAt.getTime();
  return stalled >= STALL_MIN_MS && stalled <= STALL_MAX_MS;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const minutesText = (n: number) => (n === 1 ? 'דקה אחת' : `${n} דקות`);
const leftText = (n: number) => (n === 1 ? 'נשאר צעד אחד' : `נשארו ${n} צעדים`);

export function buildReminder(next: NextStep, unsub: string): { subject: string; html: string; text: string } {
  const subject = `הצעד הבא בהקמה של העסק שלך בגוגל: ${next.title}`;
  const link = `${APP_URL}/dashboard`;
  const line = `${leftText(next.left)} מתוך ${STEPS.length}. ההתקדמות שלך נשמרה.`;
  const text = `התחלת להקים את הכרטיס של העסק שלך בגוגל.\n${line}\n\nהצעד הבא: ${next.title} (${minutesText(next.minutes)}).\n\nלהמשך: ${link}\n\nזה המייל היחיד שנשלח על כך. לא רוצים לקבל סיכומים והתראות במייל? ${unsub}`;
  const html = `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1e293b;line-height:1.6">
  <h2 style="margin:0 0 4px;font-size:20px">הצעד הבא בהקמה של העסק שלך</h2>
  <p style="margin:0 0 16px;color:#64748b;font-size:14px">${esc(line)}</p>
  <div style="background:#f1f5f9;border-radius:12px;padding:16px;margin-bottom:16px">
    <div style="font-size:18px;font-weight:700">${esc(next.title)}</div>
    <div style="color:#64748b;font-size:14px">${esc(minutesText(next.minutes))}</div>
  </div>
  <p style="margin:0 0 24px"><a href="${esc(link)}" style="background:#2E63F6;color:#fff;border-radius:8px;padding:10px 18px;text-decoration:none;font-weight:600;display:inline-block">להמשך ההקמה</a></p>
  <p style="color:#94a3b8;font-size:12px">זה המייל היחיד שנשלח על כך. קיבלתם אותו כי יש לכם את מוצר הקידום ב-Pagey. <a href="${esc(unsub)}" style="color:#94a3b8">הפסקת קבלת סיכומים והתראות במייל</a></p>
</div>`;
  return { subject, html, text };
}

// ─── Data ───────────────────────────────────────────────────────────────────
const SETUP_TICKS = STEPS.map((s) => s.id).filter((id) => id !== 'connect');

export async function gatherProgress(email: string): Promise<Progress> {
  const [biz, ticks, journey, premium] = await Promise.all([
    supabase.from('seo_businesses').select('created_at').eq('owner_email', email).order('created_at', { ascending: true }).limit(1),
    supabase.from('seo_setup_steps').select('step_key, done_at').eq('email', email),
    supabase.from('seo_journey').select('beta_activated_at, registered_at').eq('email', email).maybeSingle(),
    supabase.from('seo_manual_premium').select('status').eq('email', email).maybeSingle(),
  ]);
  const t = (v: unknown) => { const d = typeof v === 'string' ? new Date(v) : null; return d && Number.isFinite(d.getTime()) ? d.getTime() : 0; };
  const tickRows = ((ticks.data ?? []) as { step_key: string; done_at: string }[]).filter((r) => SETUP_TICKS.includes(r.step_key as never));
  const j = (journey.data ?? null) as { beta_activated_at?: string | null; registered_at?: string | null } | null;
  const last = Math.max(
    t(((biz.data ?? []) as { created_at: string }[])[0]?.created_at),
    ...tickRows.map((r) => t(r.done_at)),
    t(j?.beta_activated_at),
  );
  return {
    hasBusiness: ((biz.data ?? []) as unknown[]).length > 0,
    ticks: tickRows.map((r) => r.step_key),
    lastProgressAt: last > 0 ? new Date(last) : null,
    premium: ((premium.data ?? null) as { status?: string } | null)?.status === 'active',
  };
}

// ─── Sending ────────────────────────────────────────────────────────────────
export interface Mail { to: string; subject: string; html: string; text: string; unsub: string }
export interface SweepDeps {
  recipients(now: Date): Promise<string[]>;
  progress(email: string): Promise<Progress>;
  claim(email: string): Promise<boolean>;
  release(email: string): Promise<void>;
  send(mail: Mail): Promise<void>;
}

export const realDeps: SweepDeps = {
  recipients: listRecipients,
  progress: gatherProgress,
  async claim(email) {
    const { error } = await supabase.from('seo_digest_log').insert({ email, month: CLAIM_KEY });
    if (!error) return true;
    if (error.code === '23505') return false;
    throw new Error(error.message);
  },
  async release(email) { await supabase.from('seo_digest_log').delete().eq('email', email).eq('month', CLAIM_KEY); },
  async send(m) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY missing');
    const r = await new Resend(apiKey).emails.send({
      from: `Pagey <${process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'}>`, to: [m.to], subject: m.subject, html: m.html, text: m.text,
      headers: { 'List-Unsubscribe': `<${m.unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    if (r.error) throw new Error(r.error.message);
  },
};

export async function sweepReminders(now = new Date(), deps: SweepDeps = realDeps): Promise<{ sent: number; skipped: number; failed: number }> {
  const out = { sent: 0, skipped: 0, failed: 0 };
  if (!reminderEnabled()) return out;
  for (const email of await deps.recipients(now)) {
    if (out.sent + out.failed >= MAX_PER_SWEEP) break;
    let claimed = false;
    try {
      const p = await deps.progress(email);
      const next = nextStep(p);
      if (!next || !isDue(p, now)) { out.skipped++; continue; }
      claimed = await deps.claim(email);
      if (!claimed) { out.skipped++; continue; }
      const unsub = unsubUrl(email);
      await deps.send({ to: email, ...buildReminder(next, unsub), unsub });
      out.sent++;
    } catch (e) {
      out.failed++;
      if (claimed) await deps.release(email).catch(() => undefined);
      console.error('[SETUP-REMINDER] failed for one account:', e instanceof Error ? e.message : e);
    }
  }
  if (out.sent || out.failed) console.log('[SETUP-REMINDER] sweep', out);
  return out;
}

export function startSetupReminderSweep(): void {
  if (!reminderEnabled()) return;
  const run = () => { withHeartbeat('setup_reminder', sweepReminders).catch((e) => console.error('[SETUP-REMINDER] sweep crashed:', e)); };
  setTimeout(run, 4 * 60 * 1000);
  setInterval(run, SWEEP_EVERY_MS).unref?.();
}
