// ─────────────────────────────────────────────────────────────────────────────
// draft.mailer.ts — reminder / final-warning emails for abandoned drafts.
// Same transport and visual language as renewal.mailer.ts. Best-effort: a mail
// failure is logged and swallowed, the sweep never stalls on the provider.
// ─────────────────────────────────────────────────────────────────────────────

import { Resend } from 'resend';

const APP_URL = (process.env.PUBLIC_APP_URL || 'https://pagey.co.il').replace(/\/$/, '');

export type DraftReminderKind = 'day1' | 'day7' | 'day30';

export interface DraftReminderParams {
  kind: DraftReminderKind;
  to: string;
  businessName: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function copyFor(kind: DraftReminderKind, businessName: string) {
  const name = escapeHtml(businessName);
  switch (kind) {
    case 'day1':
      return {
        subject: `הדף של ${businessName} מוכן ומחכה לך`,
        emoji: '✨',
        headline: 'הדף שלך מוכן — נשאר רק לפרסם',
        lead: `יצרת דף נחיתה עבור <strong>${name}</strong>, אבל הוא עדיין לא באוויר.`,
        body: 'הדף שמור בחשבון שלך. אפשר להיכנס, לשפר מה שרוצים ולפרסם אותו בכמה לחיצות — ואז לקוחות יכולים להתחיל לפנות אליך.',
        cta: 'להמשיך לדף שלי',
        accent: '#6366f1',
      };
    case 'day7':
      return {
        subject: `הדף של ${businessName} עדיין מחכה לפרסום`,
        emoji: '⏳',
        headline: 'הדף שלך עדיין מחכה',
        lead: `עברה שבוע מאז שיצרת את דף הנחיתה של <strong>${name}</strong>, והוא עדיין לא פורסם.`,
        body: 'עוד לא מאוחר: הדף שמור אצלנו, ואפשר לפרסם אותו בכל רגע. דפי טיוטה שלא מפורסמים נמחקים אוטומטית לאחר כחודש, אז כדאי לא לחכות יותר מדי.',
        cta: 'לפרסם את הדף',
        accent: '#f59e0b',
      };
    case 'day30':
    default:
      return {
        subject: `הטיוטה של ${businessName} תימחק בעוד 7 ימים`,
        emoji: '🚨',
        headline: 'הטיוטה תימחק בעוד 7 ימים',
        lead: `דף הנחיתה של <strong>${name}</strong> לא פורסם כבר חודש.`,
        body: 'בעוד 7 ימים, אם הדף לא יפורסם, הוא <strong>יימחק לצמיתות</strong> ולא ניתן יהיה לשחזר אותו. אם הוא עדיין רלוונטי עבורך — זה הזמן להיכנס ולפרסם.',
        cta: 'להציל את הדף ולפרסם',
        accent: '#dc2626',
      };
  }
}

function buildEmailHtml(p: DraftReminderParams): { subject: string; html: string } {
  const c = copyFor(p.kind, p.businessName);
  const url = `${APP_URL}/dashboard`;

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
        </td>
      </tr>
      <tr>
        <td style="padding:14px 32px 28px;text-align:center;">
          <a href="${escapeHtml(url)}"
             style="display:inline-block;background:${c.accent};color:#fff;font-size:15px;font-weight:700;padding:14px 32px;border-radius:12px;text-decoration:none;">
            ${escapeHtml(c.cta)}
          </a>
        </td>
      </tr>
      <tr>
        <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 32px;">
          <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
            מופעל על ידי Pagey · ${escapeHtml(p.businessName)}
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

/** Send one draft email. Returns true only if Resend accepted it. Never throws. */
export async function sendDraftReminder(p: DraftReminderParams): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[DRAFT MAIL] RESEND_API_KEY not set — skipping', { kind: p.kind });
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
    console.log('[DRAFT MAIL] sent', { kind: p.kind, to: p.to });
    return true;
  } catch (err) {
    console.error('[DRAFT MAIL] send failed', { kind: p.kind, to: p.to, err });
    return false;
  }
}
