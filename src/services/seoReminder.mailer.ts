// "Your year is ending" email for an annual Google-promotion plan (task #30).
// An annual plan is a single payment and never renews by itself, so the reminder is the customer's
// only heads-up before access (and the attached landing page, if any) ends. Honest wording: nothing
// is charged automatically; to continue, they buy a new plan. Best-effort like every mail here:
// a failure is logged and the caller carries on.

import { Resend } from 'resend';

const APP_URL = (process.env.PUBLIC_APP_URL || 'https://pagey.co.il').replace(/\/$/, '');

export interface AnnualReminderParams {
  to: string;
  periodEnd: string | null;   // ISO
  withPage: boolean;
}

function hebrewDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function buildAnnualReminder(p: AnnualReminderParams): { subject: string; html: string; text: string } {
  const when = hebrewDate(p.periodEnd);
  const whenPart = when ? ` ב-${when}` : ' בקרוב';
  const pageNote = p.withPage ? ' דף הנחיתה שצורף למנוי יושהה בתום התקופה, ויחזור לאוויר אם תרכשו מנוי חדש.' : '';
  const subject = 'המנוי השנתי שלכם לקידום בגוגל מסתיים' + (when ? ` ב-${when}` : ' בקרוב');
  const text = `המנוי השנתי שלכם מסתיים${whenPart}. הוא לא מתחדש אוטומטית ולא יתבצע חיוב. כדי להמשיך בלי הפסקה, אפשר לרכוש מנוי חדש.${pageNote}`;
  const url = `${APP_URL}/seo-plan`;
  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 16px;font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;direction:rtl;">
<table width="540" align="center" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;padding:28px 32px;">
<tr><td>
<h1 style="margin:0 0 12px;font-size:20px;color:#1e293b;">המנוי השנתי מסתיים${when ? ` ב-${when}` : ' בקרוב'}</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#475569;">שילמתם על שנה אחת של קידום העסק בגוגל, והיא מסתיימת${whenPart}. המנוי <strong>לא מתחדש אוטומטית</strong> ולא יתבצע חיוב נוסף.</p>
<p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#475569;">כדי להמשיך בלי הפסקה, אפשר לרכוש מנוי חדש.${pageNote}</p>
<p style="margin:0;text-align:center;"><a href="${url}" style="display:inline-block;background:#2563eb;color:#fff;font-size:15px;font-weight:700;padding:13px 28px;border-radius:12px;text-decoration:none;">לבחירת מנוי</a></p>
</td></tr></table></body></html>`;
  return { subject, html, text };
}

export async function sendAnnualReminder(p: AnnualReminderParams): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.warn('[SEO REMINDER] RESEND_API_KEY not set — skipping'); return false; }
  const { subject, html, text } = buildAnnualReminder(p);
  try {
    await new Resend(apiKey).emails.send({
      from: `Pagey <${process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'}>`,
      to: [p.to], subject, html, text,
    });
    console.log('[SEO REMINDER] sent annual reminder');
    return true;
  } catch (err) {
    console.error('[SEO REMINDER] send failed', err instanceof Error ? err.message : err);
    return false;
  }
}
