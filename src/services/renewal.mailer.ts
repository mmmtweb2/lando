// ─────────────────────────────────────────────────────────────────────────────
// renewal.mailer.ts — the renewal reminder emails.
//
// Same transport and same visual language as the new-lead email in
// lead.controller.ts (Resend, RESEND_FROM_EMAIL, RTL Hebrew table layout,
// gradient header, one big call-to-action button) so the customer sees one
// consistent Pagey voice rather than two email systems.
//
// Every send here is best-effort: a mail failure is logged and swallowed. The
// lifecycle must never stall on the mail provider — a page cannot stay live
// forever because Resend was down, and a frozen page cannot fail to freeze.
// ─────────────────────────────────────────────────────────────────────────────

import { Resend } from 'resend';
import { RENEWAL_PRICE } from '../config/billing';

const APP_URL = (process.env.PUBLIC_APP_URL || 'https://pagey.co.il').replace(/\/$/, '');

export type ReminderKind = 'month' | 'week' | 'expiry_day' | 'frozen';

export interface ReminderParams {
  kind: ReminderKind;
  to: string;
  pageId: string;
  slug: string;
  businessName: string;
  expiresAt: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatHebrewDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ─── Per-stage copy ──────────────────────────────────────────────────────────
// The tone escalates deliberately: a friendly heads-up a month out, a clear
// warning a week out, an urgent note on the day, and a factual "it's offline,
// here's the one button that fixes it" once frozen. Nothing threatens deletion
// before the freeze email, because nothing is deleted before then.

interface Copy {
  subject: string;
  emoji: string;
  headline: string;
  lead: string;
  body: string;
  cta: string;
  accent: string;
}

function copyFor(kind: ReminderKind, businessName: string, expiryText: string): Copy {
  const name = escapeHtml(businessName);
  const when = expiryText ? ` (${escapeHtml(expiryText)})` : '';

  switch (kind) {
    case 'month':
      return {
        subject: `דף הנחיתה של ${businessName} מתחדש בעוד חודש`,
        emoji: '📅',
        headline: 'עוד חודש לחידוש',
        lead: `דף הנחיתה של <strong>${name}</strong> פעיל כבר כמעט שנה — כל הכבוד!`,
        body: `התוקף שלו מסתיים בעוד כ־30 יום${when}. חידוש שנתי עולה ${RENEWAL_PRICE} ₪ בלבד, והדף ממשיך לעבוד בדיוק כמו היום — אותה כתובת, אותו תוכן, אותם לידים.`,
        cta: `חדשו עכשיו — ${RENEWAL_PRICE} ₪`,
        accent: '#6366f1',
      };
    case 'week':
      return {
        subject: `נותר שבוע: חידוש דף הנחיתה של ${businessName}`,
        emoji: '⏳',
        headline: 'נשאר שבוע לחידוש',
        lead: `התוקף של דף הנחיתה של <strong>${name}</strong> מסתיים בעוד כשבוע${when}.`,
        body: `כדי שהדף ימשיך להיות זמין ללקוחות שלכם, יש לחדש אותו — ${RENEWAL_PRICE} ₪ לשנה נוספת. הכתובת, העיצוב והלידים נשארים בדיוק כפי שהם.`,
        cta: `חדשו עכשיו — ${RENEWAL_PRICE} ₪`,
        accent: '#f59e0b',
      };
    case 'expiry_day':
      return {
        subject: `היום מסתיים התוקף של דף הנחיתה של ${businessName}`,
        emoji: '⚠️',
        headline: 'התוקף מסתיים היום',
        lead: `התוקף של דף הנחיתה של <strong>${name}</strong> מסתיים היום${when}.`,
        body: `הדף עדיין באוויר ויישאר פעיל עוד שבוע נוסף כתקופת חסד. אם לא יחודש עד אז, הוא ירד מהאוויר באופן זמני — אבל <strong>לא יימחק</strong>: התוכן והלידים נשמרים, ותוכלו להחזיר אותו לאוויר בכל רגע בתשלום של ${RENEWAL_PRICE} ₪.`,
        cta: `חדשו עכשיו — ${RENEWAL_PRICE} ₪`,
        accent: '#ef4444',
      };
    case 'frozen':
    default:
      return {
        subject: `דף הנחיתה של ${businessName} ירד מהאוויר — ניתן להחזירו`,
        emoji: '🔒',
        headline: 'הדף ירד מהאוויר',
        lead: `דף הנחיתה של <strong>${name}</strong> לא חודש, ולכן הוא כרגע אינו זמין למבקרים.`,
        body: `<strong>שום דבר לא נמחק.</strong> התוכן, העיצוב וכל הלידים שנאספו שמורים אצלנו במלואם, והדף יחזור לאוויר באותה כתובת בדיוק ברגע שתחדשו — ${RENEWAL_PRICE} ₪ לשנה. הדף נשמר אצלנו למשך 12 חודשים; אם לא יחודש עד אז, הוא והלידים שלו יימחקו לצמיתות.`,
        cta: `החזירו את הדף לאוויר — ${RENEWAL_PRICE} ₪`,
        accent: '#0ea5e9',
      };
  }
}

function buildEmailHtml(p: ReminderParams): { subject: string; html: string } {
  const expiryText = formatHebrewDate(p.expiresAt);
  const c = copyFor(p.kind, p.businessName, expiryText);

  // The CTA lands on the dashboard with the page pre-selected for renewal; the
  // dashboard opens the SUMIT checkout for purpose 'renew'. Deliberately NOT a
  // direct payment link: nothing should be chargeable straight from an email
  // link, and the customer should be signed in as themselves before paying.
  const renewUrl = `${APP_URL}/dashboard?renew=${encodeURIComponent(p.pageId)}`;
  const pageUrl = `${APP_URL}/p/${encodeURIComponent(p.slug)}`;

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;direction:rtl;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;background:#f1f5f9;">
  <tr><td align="center">
    <table width="540" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">

      <tr>
        <td style="background:linear-gradient(135deg,${c.accent} 0%,#8b5cf6 100%);padding:28px 32px;">
          <p style="margin:0;color:rgba(255,255,255,0.65);font-size:11px;letter-spacing:2px;text-transform:uppercase;">Pagey</p>
          <h1 style="margin:8px 0 4px;color:#fff;font-size:22px;font-weight:800;">${c.emoji} ${escapeHtml(c.headline)}</h1>
          <p style="margin:0;color:rgba(255,255,255,0.85);font-size:14px;">${c.lead}</p>
        </td>
      </tr>

      <tr>
        <td style="padding:28px 32px 8px;">
          <p style="margin:0 0 18px;color:#475569;font-size:15px;line-height:1.7;">${c.body}</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#f8fafc;border-radius:10px;padding:13px 16px;">
                <p style="margin:0;color:#94a3b8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">הדף</p>
                <p style="margin:5px 0 0;color:#1e293b;font-size:15px;font-weight:600;">${escapeHtml(p.businessName)}</p>
                <p style="margin:4px 0 0;color:#64748b;font-size:12px;direction:ltr;text-align:right;">${escapeHtml(pageUrl)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <tr>
        <td style="padding:22px 32px 28px;text-align:center;">
          <a href="${escapeHtml(renewUrl)}"
             style="display:inline-block;background:${c.accent};color:#fff;font-size:15px;font-weight:700;padding:14px 32px;border-radius:12px;text-decoration:none;">
            ${escapeHtml(c.cta)}
          </a>
          <p style="margin:14px 0 0;color:#94a3b8;font-size:12px;">
            תשלום חד־פעמי. אין חיוב אוטומטי ואין מנוי מתמשך.
          </p>
        </td>
      </tr>

      <tr>
        <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 32px;">
          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
            מופעל על ידי Pagey · דף הנחיתה של ${escapeHtml(p.businessName)}
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { subject: c.subject, html };
}

/**
 * Send one lifecycle email. Returns true only if Resend accepted it.
 *
 * Never throws — the caller (the sweep) treats mail as best-effort and must
 * continue freezing/deleting regardless.
 */
export async function sendRenewalReminder(p: ReminderParams): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[RENEW MAIL] RESEND_API_KEY not set — skipping', { kind: p.kind, pageId: p.pageId });
    return false;
  }

  const { subject, html } = buildEmailHtml(p);

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: `Pagey <${process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'}>`,
      to: [p.to],
      subject,
      html,
    });
    console.log('[RENEW MAIL] sent', { kind: p.kind, to: p.to, pageId: p.pageId });
    return true;
  } catch (err) {
    console.error('[RENEW MAIL] send failed', { kind: p.kind, to: p.to, pageId: p.pageId, err });
    return false;
  }
}
