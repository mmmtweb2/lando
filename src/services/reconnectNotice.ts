// "The Google connection stopped working" email (audit 16.11). Without it a customer whose Google
// connection expired or was revoked silently dropped out of the automatic product: no posts, no
// replies, and nobody told them.
//
//   • Sent ONCE per break: gbpStore.markNeedsReconnect calls it only when the connection moved from
//     active to needs_reconnect (a reconnect makes it active again, so a later break mails again).
//   • Only to an account that has the product and did not unsubscribe (the digest's list), with the
//     same signed one-click unsubscribe link. Needs DIGEST_SECRET and RESEND_API_KEY, like the alerts.
//   • Best effort: a failed send is logged, never thrown into the Google call that found the break.

import { Resend } from 'resend';
import { supabase } from '../config/supabase';
import { listRecipients, unsubUrl } from './digest.service';

const APP_URL = (process.env.PUBLIC_APP_URL || 'https://pagey.co.il').replace(/\/$/, '');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const reconnectNoticeEnabled = (): boolean => !!process.env.DIGEST_SECRET && !!process.env.RESEND_API_KEY;

export function buildReconnectEmail(business: string, unsub: string): { subject: string; html: string; text: string } {
  const biz = business.trim() || 'העסק שלכם';
  const subject = `החיבור לכרטיס של ${biz} בגוגל נותק`;
  const line = 'גוגל הפסיקה לאשר לנו גישה לכרטיס העסק שלכם. זה קורה לפעמים אחרי שינוי סיסמה, הסרת הרשאה או זמן ארוך בלי חיבור.';
  const body = 'עד שתחברו את הכרטיס מחדש אנחנו לא יכולים לפרסם פוסטים ולענות לביקורות בשבילכם. החיבור מחדש לוקח דקה: נכנסים לדשבורד ולוחצים "חיבור מחדש".';
  const text = `${line}\n${body}\n\nלחיבור מחדש: ${APP_URL}/dashboard\n\nלא רוצים לקבל סיכומים והתראות במייל? ${unsub}`;
  const html = `<div dir="rtl" style="font-family:Heebo,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1e293b;line-height:1.6">
  <h2 style="margin:0 0 8px;font-size:20px">${esc(subject)}</h2>
  <p style="margin:0 0 8px">${esc(line)}</p>
  <p style="margin:0 0 20px">${esc(body)}</p>
  <p style="margin:0 0 24px"><a href="${esc(APP_URL)}/dashboard" style="background:#2E63F6;color:#fff;border-radius:8px;padding:10px 18px;text-decoration:none;font-weight:600;display:inline-block">לחיבור מחדש</a></p>
  <p style="color:#94a3b8;font-size:12px">קיבלתם את המייל כי חיברתם את כרטיס העסק שלכם בגוגל ל-Pagey. <a href="${esc(unsub)}" style="color:#94a3b8">הפסקת קבלת סיכומים והתראות במייל</a></p>
</div>`;
  return { subject, html, text };
}

export interface NoticeDeps {
  recipients(): Promise<string[]>;
  business(email: string): Promise<string>;
  send(to: string, mail: { subject: string; html: string; text: string; unsub: string }): Promise<void>;
}

const realDeps: NoticeDeps = {
  recipients: () => listRecipients(),
  async business(email) {
    const { data } = await supabase.from('business_truth').select('card').eq('owner_email', email).maybeSingle();
    const name = (data as { card?: { name?: unknown } } | null)?.card?.name;
    return typeof name === 'string' ? name : '';
  },
  async send(to, m) {
    const r = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: `Pagey <${process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'}>`, to: [to], subject: m.subject, html: m.html, text: m.text,
      headers: { 'List-Unsubscribe': `<${m.unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    if (r.error) throw new Error(r.error.message);
  },
};

/** Tells the customer once that their Google connection broke. Never throws. Returns whether a mail went out. */
export async function sendReconnectNotice(email: string, deps: NoticeDeps = realDeps): Promise<boolean> {
  if (!reconnectNoticeEnabled()) return false;
  try {
    if (!(await deps.recipients()).includes(email)) return false;
    const unsub = unsubUrl(email);
    await deps.send(email, { ...buildReconnectEmail(await deps.business(email), unsub), unsub });
    return true;
  } catch (e) {
    console.error('[GBP] reconnect notice failed:', e instanceof Error ? e.message.slice(0, 160) : 'unknown');
    return false;
  }
}
