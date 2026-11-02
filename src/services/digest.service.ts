// Monthly summary email for customers of the Google-promotion product. OFF unless
// MONTHLY_DIGEST_ENABLED=true. Early each month (days 2-7, Israel time) every account that holds
// the product and has not unsubscribed gets ONE short email about the month that just ended:
// inquiries vs the month before, review requests sent, and a single next step.
// Every email carries a one-click unsubscribe link (signed, no login needed).
// The (email, month) row in seo_digest_log is claimed BEFORE sending, so a restart or a second
// instance can never send the same month twice; a failed send releases the claim for a retry.

import crypto from 'crypto';
import { Resend } from 'resend';
import { supabase } from '../config/supabase';
import { isEntitled } from './entitlements.service';
import { SMOKE_SOURCE } from './leadEvents.service';

const APP_URL = (process.env.PUBLIC_APP_URL || 'https://pagey.co.il').replace(/\/$/, '');
const API_URL = (process.env.PUBLIC_API_URL || APP_URL).replace(/\/$/, '');
const NOT_SMOKE = `source_url.is.null,source_url.neq.${SMOKE_SOURCE}`;
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const MAX_PER_SWEEP = 100;
const SEND_FROM_DAY = 2;
const SEND_UNTIL_DAY = 7;

export function digestEnabled(): boolean {
  return process.env.MONTHLY_DIGEST_ENABLED === 'true' && !!process.env.DIGEST_SECRET;
}

// ─── Unsubscribe token: base64url(email).hmac — no expiry on purpose ────────
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
function mac(email: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`digest-unsub:${email}`).digest('base64url');
}
export function signUnsub(email: string, secret = process.env.DIGEST_SECRET ?? ''): string {
  return `${b64(email)}.${mac(email, secret)}`;
}
export function verifyUnsub(token: unknown, secret = process.env.DIGEST_SECRET ?? ''): string | null {
  if (typeof token !== 'string' || !secret || token.length > 400) return null;
  const [p, m] = token.split('.');
  if (!p || !m) return null;
  let email: string;
  try { email = Buffer.from(p, 'base64url').toString('utf8'); } catch { return null; }
  const want = Buffer.from(mac(email, secret)); const got = Buffer.from(m);
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? email : null;
}
export const unsubUrl = (email: string) => `${API_URL}/api/seo/digest/unsubscribe?t=${signUnsub(email)}`;

// ─── Months (Israel time) ───────────────────────────────────────────────────
function israelParts(d: Date): { y: number; m: number; day: number } {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: n('year'), m: n('month'), day: n('day') };
}
/** UTC instant of 00:00 on the 1st of (y, m) in Israel time. */
function israelMonthStartOf(y: number, m: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', timeZoneName: 'longOffset' }).formatToParts(guess).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+02:00';
  const mm = /GMT([+-])(\d{2}):(\d{2})/.exec(off);
  const minutes = mm ? (mm[1] === '-' ? -1 : 1) * (Number(mm[2]) * 60 + Number(mm[3])) : 120;
  return new Date(guess.getTime() - minutes * 60_000);
}
export interface Bounds { dayOfMonth: number; monthKey: string; prevStart: Date; prevEnd: Date; beforeStart: Date; prevLabel: string }
/** The month that just ended (prev), the one before it (before), and the key of the month we are in. */
export function bounds(now: Date): Bounds {
  const { y, m, day } = israelParts(now);
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
  const by = pm === 1 ? py - 1 : py, bm = pm === 1 ? 12 : pm - 1;
  const prevStart = israelMonthStartOf(py, pm);
  return {
    dayOfMonth: day, monthKey: `${y}-${String(m).padStart(2, '0')}`,
    prevStart, prevEnd: israelMonthStartOf(y, m), beforeStart: israelMonthStartOf(by, bm),
    prevLabel: new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', month: 'long' }).format(new Date(prevStart.getTime() + 15 * 86400000)),
  };
}
export const inSendWindow = (now: Date) => { const d = bounds(now).dayOfMonth; return d >= SEND_FROM_DAY && d <= SEND_UNTIL_DAY; };

// ─── What goes in the email ─────────────────────────────────────────────────
export interface DigestStats { businessName: string | null; prevLabel: string; inquiries: number; inquiriesBefore: number; reviewAsks: number }

export function suggestion(s: DigestStats): string {
  if (!s.businessName) return 'חברו את העסק בלשונית "הפרופיל שלי", וקבלו בדיקה מול המתחרים באזור.';
  if (s.inquiries === 0) return 'עוד לא נספרו פניות. כדאי לוודא שהמעקב מחובר לאתר ולשתף ללקוחות את הקישור לביקורת.';
  if (s.reviewAsks === 0) return 'בקשו ביקורת מכמה לקוחות מרוצים, בלשונית "ביקורות". ביקורות חדשות משפרות את הדירוג.';
  if (s.inquiries < s.inquiriesBefore) return 'הפניות ירדו מעט. כדאי לעדכן תמונות ושעות פתיחה בפרופיל, ולהוסיף תוכן חדש.';
  return 'ממשיכים באותו כיוון. עוד כמה בקשות ביקורת החודש ועוד תוכן אחד יחזיקו את המומנטום.';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inquiriesLine = (s: DigestStats) => `${s.inquiries === 1 ? 'פנייה אחת' : `${s.inquiries} פניות`} ב${s.prevLabel}`;
function deltaLine(s: DigestStats): string {
  const d = s.inquiries - s.inquiriesBefore;
  if (s.inquiriesBefore === 0 && s.inquiries === 0) return '';
  if (d === 0) return 'בדיוק כמו החודש שלפניו.';
  return d > 0 ? `${d === 1 ? 'פנייה אחת' : `${d} פניות`} יותר מהחודש שלפניו.` : `${-d === 1 ? 'פנייה אחת' : `${-d} פניות`} פחות מהחודש שלפניו.`;
}

export function buildDigest(s: DigestStats, unsub: string): { subject: string; html: string; text: string } {
  const name = s.businessName ?? 'העסק שלכם';
  const subject = `סיכום ${s.prevLabel} ל${name}: ${inquiriesLine(s)}`;
  const delta = deltaLine(s);
  const asks = s.reviewAsks === 0 ? 'לא נשלחו בקשות ביקורת.' : `נשלחו ${s.reviewAsks === 1 ? 'בקשת ביקורת אחת' : `${s.reviewAsks} בקשות ביקורת`}.`;
  const tip = suggestion(s);
  const text = `סיכום ${s.prevLabel} ל${name}\n\n${inquiriesLine(s)}. ${delta}\n${asks}\n\nהצעד הבא: ${tip}\n\nלדשבורד: ${APP_URL}/dashboard\n\nלא רוצים לקבל את הסיכום? ${unsub}`;
  const html = `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1e293b;line-height:1.6">
  <h2 style="margin:0 0 4px;font-size:20px">סיכום ${esc(s.prevLabel)}: ${esc(name)}</h2>
  <p style="margin:0 0 16px;color:#64748b;font-size:14px">הקידום שלכם בגוגל, בקצרה.</p>
  <div style="background:#f1f5f9;border-radius:12px;padding:16px;margin-bottom:12px">
    <div style="font-size:28px;font-weight:700">${s.inquiries}</div>
    <div>${esc(inquiriesLine(s))}${delta ? `<br><span style="color:#64748b;font-size:14px">${esc(delta)}</span>` : ''}</div>
  </div>
  <p style="margin:0 0 12px">${esc(asks)}</p>
  <p style="margin:0 0 16px"><b>הצעד הבא:</b> ${esc(tip)}</p>
  <p style="margin:0 0 24px"><a href="${esc(APP_URL)}/dashboard" style="background:#2E63F6;color:#fff;border-radius:8px;padding:10px 18px;text-decoration:none;font-weight:600;display:inline-block">לדשבורד</a></p>
  <p style="color:#94a3b8;font-size:12px">קיבלתם את המייל כי יש לכם את מוצר הקידום ב-Pagey. <a href="${esc(unsub)}" style="color:#94a3b8">הפסקת קבלת הסיכום החודשי</a></p>
</div>`;
  return { subject, html, text };
}

// ─── Data ───────────────────────────────────────────────────────────────────
async function countInquiries(email: string, fromIso: string, toIso: string): Promise<number> {
  const [{ data: pages }, { data: biz }] = await Promise.all([
    supabase.from('landing_pages').select('id').eq('owner_email', email),
    supabase.from('seo_businesses').select('id').eq('owner_email', email),
  ]);
  const pageIds = ((pages ?? []) as { id: string }[]).map((p) => p.id);
  const bizIds = ((biz ?? []) as { id: string }[]).map((b) => b.id);
  const jobs: PromiseLike<{ count: number | null; error: unknown }>[] = [];
  if (pageIds.length) {
    jobs.push(supabase.from('leads').select('id', { count: 'exact', head: true }).in('landing_page_id', pageIds).gte('created_at', fromIso).lt('created_at', toIso));
    jobs.push(supabase.from('lead_events').select('id', { count: 'exact', head: true }).in('landing_page_id', pageIds).in('event_type', ['whatsapp', 'call', 'email']).gte('created_at', fromIso).lt('created_at', toIso).or(NOT_SMOKE));
  }
  if (bizIds.length) {
    jobs.push(supabase.from('lead_events').select('id', { count: 'exact', head: true }).in('business_id', bizIds).in('event_type', ['whatsapp', 'call', 'email']).gte('created_at', fromIso).lt('created_at', toIso).or(NOT_SMOKE));
  }
  const res = await Promise.all(jobs);
  return res.reduce((n, r) => n + (r.count ?? 0), 0);
}

export async function gatherStats(email: string, now = new Date()): Promise<DigestStats> {
  const b = bounds(now);
  const { data: biz } = await supabase.from('seo_businesses').select('name').eq('owner_email', email).order('created_at', { ascending: true }).limit(1);
  const [inq, before, asks] = await Promise.all([
    countInquiries(email, b.prevStart.toISOString(), b.prevEnd.toISOString()),
    countInquiries(email, b.beforeStart.toISOString(), b.prevStart.toISOString()),
    supabase.from('review_requests').select('id', { count: 'exact', head: true }).eq('owner_email', email).gte('sent_at', b.prevStart.toISOString()).lt('sent_at', b.prevEnd.toISOString()),
  ]);
  return { businessName: ((biz ?? []) as { name: string }[])[0]?.name ?? null, prevLabel: b.prevLabel, inquiries: inq, inquiriesBefore: before, reviewAsks: asks.count ?? 0 };
}

export async function listRecipients(now = new Date()): Promise<string[]> {
  const { data, error } = await supabase.from('user_products').select('email, status, current_period_end').eq('product', 'seo_autopilot');
  if (error) throw new Error(error.message);
  const eligible = ((data ?? []) as { email: string; status: string; current_period_end: string | null }[]).filter((r) => isEntitled(r, now)).map((r) => r.email);
  if (!eligible.length) return [];
  const { data: off } = await supabase.from('seo_email_prefs').select('email').eq('monthly_digest', false).in('email', eligible);
  const out = new Set(((off ?? []) as { email: string }[]).map((r) => r.email));
  return eligible.filter((e) => !out.has(e));
}

export async function setDigestPref(email: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('seo_email_prefs').upsert({ email, monthly_digest: on, updated_at: new Date().toISOString() }, { onConflict: 'email' });
  if (error) throw new Error(error.message);
}

// ─── Sending ────────────────────────────────────────────────────────────────
export interface Mail { to: string; subject: string; html: string; text: string; unsub: string }
export interface SweepDeps {
  recipients(now: Date): Promise<string[]>;
  claim(email: string, month: string): Promise<boolean>;
  release(email: string, month: string): Promise<void>;
  stats(email: string, now: Date): Promise<DigestStats>;
  send(mail: Mail): Promise<void>;
}

export const realDeps: SweepDeps = {
  recipients: listRecipients,
  async claim(email, month) {
    const { error } = await supabase.from('seo_digest_log').insert({ email, month });
    if (!error) return true;
    if (error.code === '23505') return false;
    throw new Error(error.message);
  },
  async release(email, month) { await supabase.from('seo_digest_log').delete().eq('email', email).eq('month', month); },
  stats: gatherStats,
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

export async function sweepDigests(now = new Date(), deps: SweepDeps = realDeps): Promise<{ sent: number; skipped: number; failed: number }> {
  const out = { sent: 0, skipped: 0, failed: 0 };
  if (!digestEnabled() || !inSendWindow(now)) return out;
  const month = bounds(now).monthKey;
  for (const email of await deps.recipients(now)) {
    if (out.sent + out.failed >= MAX_PER_SWEEP) break;
    let claimed = false;
    try {
      claimed = await deps.claim(email, month);
      if (!claimed) { out.skipped++; continue; }
      const unsub = unsubUrl(email);
      const mail = buildDigest(await deps.stats(email, now), unsub);
      await deps.send({ to: email, ...mail, unsub });
      out.sent++;
    } catch (e) {
      out.failed++;
      if (claimed) await deps.release(email, month).catch(() => undefined);
      console.error('[DIGEST] failed for one account:', e instanceof Error ? e.message : e);
    }
  }
  if (out.sent || out.failed) console.log('[DIGEST] sweep', out);
  return out;
}

export function startDigestSweep(): void {
  if (!digestEnabled()) return;
  const run = () => { sweepDigests().catch((e) => console.error('[DIGEST] sweep crashed:', e)); };
  setTimeout(run, 2 * 60 * 1000);
  setInterval(run, SWEEP_EVERY_MS).unref?.();
}
