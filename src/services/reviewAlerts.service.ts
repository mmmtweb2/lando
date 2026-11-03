// Unanswered-review alerts (task #8.4). OFF unless ALERTS_ENABLED=true (and DIGEST_SECRET and
// RESEND_API_KEY exist, because every email carries the signed unsubscribe link).
//
// For customers who connected their Google Business Profile: a Google review that has waited
// 5-30 days without a reply gets a DRAFT reply and ONE email to the owner. Nothing is ever
// published by itself: the owner reads the review and the draft in the dashboard, may edit the
// text, and publishes with one click (or dismisses it).
//
//   • Idempotent: the (owner_email, review_id) key in review_reply_drafts is claimed before any
//     email; a review is alerted once, ever. A failed email is retried on the next sweep (3 days max).
//   • Stores no review text (see migration 038); reviews are fetched live when the owner opens them.
//   • The Business Profile API quota is 0 until Google approves access: every Google call then
//     fails with 429, the sweep counts it and moves on.
//   • Unverified against live Google until the access request is approved: covered by tests with
//     fake Google responses only.

import { recordHeartbeat, withHeartbeat } from './opsMetrics.service';
import { Resend } from 'resend';
import { supabase } from '../config/supabase';
import { gbpOAuthConfig } from '../config/gbp';
import { decryptToken } from './gbpCrypto';
import { GbpError, accessTokenFrom, listLocations, listReviews, postReply, type GbpReview } from './gbpGoogle';
import { getConnection, markNeedsReconnect } from './gbpStore';
import { listRecipients, unsubUrl } from './digest.service';

const APP_URL = (process.env.PUBLIC_APP_URL || 'https://pagey.co.il').replace(/\/$/, '');
export const MIN_AGE_DAYS = 5;
export const MAX_AGE_DAYS = 30;
const SWEEP_EVERY_MS = 12 * 60 * 60 * 1000;
const MAX_ACCOUNTS_PER_SWEEP = 50;
const MAX_NEW_DRAFTS_PER_ACCOUNT = 5;
const RETRY_NOTIFY_DAYS = 3;
const DAY = 86_400_000;

export function reviewAlertsEnabled(): boolean {
  return process.env.ALERTS_ENABLED === 'true' && !!process.env.DIGEST_SECRET && !!process.env.RESEND_API_KEY;
}

// ── Pure logic ───────────────────────────────────────────────────────────────

/** Reviews with no reply from the owner that are 5 to 30 days old. */
export function candidates(reviews: GbpReview[], now: Date): GbpReview[] {
  return reviews.filter(r => {
    if (r.hasReply) return false;
    const age = (now.getTime() - Date.parse(r.createdAt)) / DAY;
    return age >= MIN_AGE_DAYS && age <= MAX_AGE_DAYS;
  });
}

/** Letters only, at most 20 characters; anything else (links, emoji, digits) means "no name". */
export function firstName(display: string | null): string | null {
  if (!display) return null;
  const w = display.trim().split(/\s+/)[0] ?? '';
  return /^[\p{L}'’-]{2,20}$/u.test(w) ? w : null;
}

/**
 * A short, honest starting point in Hebrew. It never invents details of the visit and never
 * promises anything; the owner edits it before publishing.
 */
export function draftReply(rating: number, reviewer: string | null, business: string): string {
  const who = firstName(reviewer);
  const hello = who ? `שלום ${who},` : 'שלום,';
  const biz = business.trim().slice(0, 60) || 'העסק';
  if (rating >= 4) return `${hello} תודה רבה על הביקורת ועל המילים החמות! שמחים שנהניתם, ונשמח לראות אתכם שוב. צוות ${biz}`;
  if (rating === 3) return `${hello} תודה שלקחתם את הזמן לכתוב לנו. נשמח לשמוע עוד על החוויה ולהשתפר, מוזמנים ליצור איתנו קשר ישירות. צוות ${biz}`;
  return `${hello} תודה על המשוב, ואנחנו מצטערים שהחוויה לא הייתה כפי שציפיתם. חשוב לנו להבין ולתקן, נשמח אם תיצרו איתנו קשר ישירות כדי שנוכל לטפל בזה. צוות ${biz}`;
}

export const MAX_REPLY_LEN = 4000;

export function validReplyText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return t.length >= 2 && t.length <= MAX_REPLY_LEN ? t : null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface DraftRow {
  id: string; owner_email: string; review_id: string; location_name: string; rating: number;
  reviewer_first: string | null; review_created_at: string; draft: string; status: 'pending' | 'published' | 'dismissed';
  notified_at: string | null;
}
export type NewDraft = Omit<DraftRow, 'id' | 'status' | 'notified_at'>;

export function buildAlertEmail(business: string, count: number, unsub: string): { subject: string; html: string; text: string } {
  const biz = business.trim() || 'העסק שלכם';
  const subject = count === 1 ? `ביקורת אחת ב-${biz} מחכה לתשובה` : `${count} ביקורות ב-${biz} מחכות לתשובה`;
  const line = count === 1 ? 'יש ביקורת בגוגל שלא נענתה כבר כמה ימים.' : `יש ${count} ביקורות בגוגל שלא נענו כבר כמה ימים.`;
  const body = 'הכנו לכל אחת טיוטת תשובה. אפשר לקרוא, לערוך אם צריך, להעתיק ולהדביק בכרטיס העסק שלכם בגוגל.';
  const text = `${line}\n${body}\n\nלתשובות המוכנות: ${APP_URL}/dashboard\n\nלא רוצים לקבל סיכומים והתראות במייל? ${unsub}`;
  const html = `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1e293b;line-height:1.6">
  <h2 style="margin:0 0 8px;font-size:20px">${esc(subject)}</h2>
  <p style="margin:0 0 8px">${esc(line)}</p>
  <p style="margin:0 0 20px">${esc(body)}</p>
  <p style="margin:0 0 24px"><a href="${esc(APP_URL)}/dashboard" style="background:#2E63F6;color:#fff;border-radius:8px;padding:10px 18px;text-decoration:none;font-weight:600;display:inline-block">לתשובות המוכנות</a></p>
  <p style="color:#94a3b8;font-size:12px">קיבלתם את המייל כי חיברתם את כרטיס העסק שלכם בגוגל ל-Pagey. <a href="${esc(unsub)}" style="color:#94a3b8">הפסקת קבלת סיכומים והתראות במייל</a></p>
</div>`;
  return { subject, html, text };
}

// ── Sweep ────────────────────────────────────────────────────────────────────

export interface SweepDeps {
  accounts(now: Date): Promise<string[]>;
  fetchReviews(email: string): Promise<{ reviews: GbpReview[]; location: string; business: string } | null>;
  claim(rows: NewDraft[]): Promise<DraftRow[]>;
  unnotified(email: string, now: Date): Promise<DraftRow[]>;
  send(to: string, mail: { subject: string; html: string; text: string; unsub: string }): Promise<void>;
  markNotified(ids: string[], now: Date): Promise<void>;
}

export interface SweepResult { accounts: number; drafted: number; emailed: number; failed: number }
export const lastRun: { at: Date | null; result: SweepResult | null } = { at: null, result: null };

export async function sweepReviewAlerts(now = new Date(), deps: SweepDeps = realDeps): Promise<SweepResult> {
  const out: SweepResult = { accounts: 0, drafted: 0, emailed: 0, failed: 0 };
  if (!reviewAlertsEnabled()) return out;
  for (const email of (await deps.accounts(now)).slice(0, MAX_ACCOUNTS_PER_SWEEP)) {
    out.accounts++;
    try {
      const got = await deps.fetchReviews(email);
      if (got) {
        void recordHeartbeat('gbp_google', null);
        const fresh = candidates(got.reviews, now).slice(0, MAX_NEW_DRAFTS_PER_ACCOUNT);
        const claimed = await deps.claim(fresh.map(r => ({
          owner_email: email, review_id: r.id, location_name: got.location, rating: r.rating,
          reviewer_first: firstName(r.reviewer), review_created_at: r.createdAt,
          draft: draftReply(r.rating, r.reviewer, got.business),
        })));
        out.drafted += claimed.length;
      }
      const todo = await deps.unnotified(email, now);
      if (todo.length) {
        await deps.send(email, { ...buildAlertEmail(got?.business ?? '', todo.length, unsubUrl(email)), unsub: unsubUrl(email) });
        await deps.markNotified(todo.map(r => r.id), now);
        out.emailed++;
      }
    } catch (e) {
      out.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      void recordHeartbeat('gbp_google', /http_429/.test(msg) ? 'google quota pending' : msg.slice(0, 120));
      // Quota-pending is expected until Google approves access: one short line, no detail.
      console.error('[REVIEW-ALERTS] one account failed:', /http_429/.test(msg) ? 'google quota pending' : msg.slice(0, 160));
    }
  }
  lastRun.at = now; lastRun.result = out;
  if (out.drafted || out.emailed || out.failed) console.log('[REVIEW-ALERTS] sweep', out);
  return out;
}

// ── Real dependencies ────────────────────────────────────────────────────────

const COLS = 'id, owner_email, review_id, location_name, rating, reviewer_first, review_created_at, draft, status, notified_at';

/** Access token for a customer's connection, or null (not connected / needs reconnect). */
export async function accessFor(email: string): Promise<string | null> {
  const cfg = gbpOAuthConfig();
  if (!cfg) return null;
  const c = await getConnection(email);
  if (!c || c.status !== 'active') return null;
  const refresh = decryptToken(c.refresh_token_enc, cfg.key);
  if (!refresh) { await markNeedsReconnect(email, 'undecryptable'); return null; }
  try { return await accessTokenFrom(refresh, cfg); } catch (e) {
    if (e instanceof GbpError && e.code === 'revoked') { await markNeedsReconnect(email, 'revoked'); return null; }
    throw e;
  }
}

const realDeps: SweepDeps = {
  async accounts(now) {
    const { data, error } = await supabase.from('gbp_connections').select('email').eq('status', 'active').not('location_name', 'is', null);
    if (error) throw new Error(error.message);
    const connected = new Set(((data ?? []) as { email: string }[]).map(r => r.email));
    return (await listRecipients(now)).filter(e => connected.has(e));
  },
  async fetchReviews(email) {
    const access = await accessFor(email);
    const c = await getConnection(email);
    if (!access || !c?.location_name) return null;
    const loc = (await listLocations(access)).find(l => l.name === c.location_name);
    if (!loc?.account) return null;
    return { reviews: await listReviews(access, loc.account, loc.name), location: loc.name, business: loc.title };
  },
  async claim(rows) {
    const created: DraftRow[] = [];
    for (const r of rows) {
      const { data, error } = await supabase.from('review_reply_drafts').insert(r).select(COLS).maybeSingle();
      if (error) { if (error.code === '23505') continue; throw new Error(error.message); }
      if (data) created.push(data as DraftRow);
    }
    return created;
  },
  async unnotified(email, now) {
    const since = new Date(now.getTime() - RETRY_NOTIFY_DAYS * DAY).toISOString();
    const { data, error } = await supabase.from('review_reply_drafts').select(COLS)
      .eq('owner_email', email).eq('status', 'pending').is('notified_at', null).gte('created_at', since);
    if (error) throw new Error(error.message);
    return (data ?? []) as DraftRow[];
  },
  async send(to, m) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY missing');
    const r = await new Resend(apiKey).emails.send({
      from: `Pagey <${process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'}>`, to: [to], subject: m.subject, html: m.html, text: m.text,
      headers: { 'List-Unsubscribe': `<${m.unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    if (r.error) throw new Error(r.error.message);
  },
  async markNotified(ids, now) {
    const { error } = await supabase.from('review_reply_drafts').update({ notified_at: now.toISOString() }).in('id', ids);
    if (error) throw new Error(error.message);
  },
};

export function startReviewAlertSweep(): void {
  if (!reviewAlertsEnabled()) return;
  const run = () => { withHeartbeat('review_alerts', sweepReviewAlerts).catch((e) => console.error('[REVIEW-ALERTS] sweep crashed:', e)); };
  setTimeout(run, 5 * 60 * 1000);
  setInterval(run, SWEEP_EVERY_MS).unref?.();
}

// ── Owner actions (dashboard) ────────────────────────────────────────────────

export class DraftError extends Error {
  constructor(public readonly code: 'not_found' | 'bad_text' | 'not_pending' | 'not_connected' | 'quota_pending' | 'google' | 'not_migrated', message = code) { super(message); }
}

const missing = (m?: string) => /does not exist|schema cache|42P01|PGRST205/i.test(m ?? '');

export async function listPending(email: string): Promise<DraftRow[]> {
  const { data, error } = await supabase.from('review_reply_drafts').select(COLS)
    .eq('owner_email', email).eq('status', 'pending').order('review_created_at', { ascending: false }).limit(20);
  if (error) { if (missing(error.message)) return []; throw new Error(error.message); }
  return (data ?? []) as DraftRow[];
}

async function getOwned(email: string, id: string): Promise<DraftRow> {
  const { data, error } = await supabase.from('review_reply_drafts').select(COLS).eq('id', id).eq('owner_email', email).maybeSingle();
  if (error) { if (missing(error.message)) throw new DraftError('not_migrated'); throw new Error(error.message); }
  if (!data) throw new DraftError('not_found');
  return data as DraftRow;
}

export async function dismiss(email: string, id: string): Promise<void> {
  const d = await getOwned(email, id);
  if (d.status !== 'pending') return;
  const { error } = await supabase.from('review_reply_drafts').update({ status: 'dismissed' }).eq('id', id).eq('owner_email', email);
  if (error) throw new Error(error.message);
}

/** The review texts of the pending drafts, fetched live (never stored). Best effort: failure = no texts. */
export async function liveTexts(email: string, drafts: DraftRow[]): Promise<Map<string, GbpReview>> {
  const out = new Map<string, GbpReview>();
  if (!drafts.length) return out;
  try {
    const access = await accessFor(email);
    if (!access) return out;
    const loc = (await listLocations(access)).find(l => l.name === drafts[0].location_name);
    if (!loc?.account) return out;
    for (const r of await listReviews(access, loc.account, loc.name)) out.set(r.id, r);
  } catch { /* the card still works without the review text */ }
  return out;
}

/**
 * Publishes the owner-approved text. `text` is what the owner saw (possibly edited), never our draft
 * unseen: the endpoint requires it in the request. Idempotent: an already published draft is a no-op.
 */
export async function publish(email: string, id: string, rawText: unknown, now = new Date()): Promise<void> {
  const text = validReplyText(rawText);
  if (!text) throw new DraftError('bad_text');
  const d = await getOwned(email, id);
  if (d.status === 'published') return;
  if (d.status !== 'pending') throw new DraftError('not_pending');
  try {
    const access = await accessFor(email);
    if (!access) throw new DraftError('not_connected');
    const loc = (await listLocations(access)).find(l => l.name === d.location_name);
    if (!loc?.account) throw new DraftError('not_connected');
    await postReply(access, loc.account, loc.name, d.review_id, text);
  } catch (e) {
    if (e instanceof DraftError) throw e;
    if (e instanceof GbpError && e.code === 'revoked') { await markNeedsReconnect(email, 'revoked').catch(() => undefined); throw new DraftError('not_connected'); }
    if (e instanceof GbpError && /http_429/.test(e.message)) throw new DraftError('quota_pending');
    console.error('[REVIEW-ALERTS] publish failed:', e instanceof Error ? e.message.slice(0, 160) : 'unknown');
    throw new DraftError('google');
  }
  const { error } = await supabase.from('review_reply_drafts')
    .update({ status: 'published', published_at: now.toISOString() }).eq('id', id).eq('owner_email', email);
  if (error) throw new Error(error.message);
}
