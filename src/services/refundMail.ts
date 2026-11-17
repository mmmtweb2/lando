// The two emails of a refund cancellation (decision 17.11.2026): one to the service owner (who refunds
// in the SUMIT dashboard), one to the customer. Never throw: a failed mail must not undo a cancellation
// that is already saved.
import { Resend } from 'resend';
import { senderFooterHtml, senderFooterText } from './mailFooter';

export interface RefundMailInfo { email: string; amount: number; paymentId: string | null; cycle: 'month' | 'year' }
export type RefundMailer = (to: string, subject: string, text: string, html: string) => Promise<void>;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

let mailer: RefundMailer | null = null;
/** Tests replace the sender. */
export function setRefundMailer(m: RefundMailer | null): void { mailer = m; }

async function send(to: string, subject: string, text: string, html: string): Promise<boolean> {
  try {
    if (mailer) { await mailer(to, subject, text, html); return true; }
    if (!process.env.RESEND_API_KEY) return false;
    const r = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: `Pagey <${process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'}>`, to: [to], subject, text, html,
    });
    if (r.error) throw new Error(r.error.message);
    return true;
  } catch (e) {
    console.error('[REFUND] mail failed:', e instanceof Error ? e.message.slice(0, 160) : 'unknown');
    return false;
  }
}

const paras = (lines: string[]) => lines.map((l) => `<p style="margin:0 0 10px">${esc(l)}</p>`).join('');

export function adminRefundMail(i: RefundMailInfo): { subject: string; text: string; html: string } {
  const subject = `החזר ממתין: ₪${i.amount} ל-${i.email}`;
  const lines = [
    'לקוח ביטל את מנוי הקידום בגוגל בתוך 14 יום מהתשלום הראשון, ומגיע לו החזר מלא.',
    `לקוח: ${i.email}`,
    `סכום להחזר: ₪${i.amount}`,
    `מזהה התשלום בסאמיט: ${i.paymentId ?? 'לא ידוע'}`,
    `מנוי: ${i.cycle === 'year' ? 'שנתי' : 'חודשי'}`,
    'המנוי כבר הסתיים והוראת הקבע נעצרה. נשאר להחזיר את התשלום בדשבורד של סאמיט, ולסמן "הוחזר" בפאנל הניהול (הכנסות).',
  ];
  return { subject, text: lines.join('\n'), html: `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.6">${paras(lines)}</div>` };
}

export function customerRefundMail(i: RefundMailInfo): { subject: string; text: string; html: string } {
  const subject = 'ביטלנו את המנוי, והכסף יוחזר אליכם';
  const lines = [
    'שלום,',
    'ביטלתם את מנוי הקידום בגוגל בתוך 14 יום מהתשלום הראשון, ולכן מגיע לכם החזר מלא.',
    `הסכום להחזר: ₪${i.amount}. הוא יוחזר לאמצעי התשלום שבו שילמתם, בימים הקרובים.`,
    'המנוי הסתיים ולא יהיו חיובים נוספים.',
    'אם תרצו לחזור, אפשר להירשם שוב מתי שתרצו.',
  ];
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">${paras(lines)}${senderFooterHtml({ reason: 'קיבלתם את המייל כי ביטלתם מנוי ב-Pagey.' })}</div>`;
  return { subject, text: `${lines.join('\n')}\n\n${senderFooterText()}`, html };
}

/** Sends both mails. Returns which went out. */
export async function sendRefundMails(i: RefundMailInfo): Promise<{ admin: boolean; customer: boolean }> {
  const a = adminRefundMail(i);
  const c = customerRefundMail(i);
  const adminTo = process.env.ADMIN_ALERT_EMAIL;
  if (!adminTo) console.error('[REFUND] ALERT refund requested but ADMIN_ALERT_EMAIL is not set', { email: i.email, amount: i.amount });
  const admin = adminTo ? await send(adminTo, a.subject, a.text, a.html) : false;
  const customer = await send(i.email, c.subject, c.text, c.html);
  return { admin, customer };
}
