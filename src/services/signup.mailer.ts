// ─────────────────────────────────────────────────────────────────────────────
// signup.mailer.ts — internal "new user signed up" alert to the founder.
//
// Same transport/pattern as renewal.mailer.ts and lead.controller.ts (Resend,
// RESEND_FROM_EMAIL). This one is NOT customer-facing — it's a one-line
// internal notification, so no RTL marketing template, just a compact HTML
// email. Recipient is ADMIN_ALERT_EMAIL (env), defaulting to the founder's
// personal address — see README for why.
//
// Best-effort like every other mailer here: a failure is logged and
// swallowed, never blocks the signup flow that triggered it.
// ─────────────────────────────────────────────────────────────────────────────

import { Resend } from 'resend';

const ADMIN_ALERT_EMAIL = process.env.ADMIN_ALERT_EMAIL || 'mmmtirnoer@gmail.com';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Fire-and-forget alert on a brand-new user_profiles row. Called from BOTH
 * insert paths (user.controller.ts's authUser new-user branch, and
 * profile.service.ts's ensureUserProfile self-heal) so it reliably fires
 * regardless of which endpoint's race wins — see README for the reasoning
 * (same pattern as the referral-attribution race fix).
 *
 * De-duplication is handled by the CALLERS (both only run this once, on the
 * actual INSERT branch, never on an existing-row read) — this function
 * itself does not check for duplicates.
 */
export async function sendNewSignupAlert(email: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[SIGNUP MAIL] RESEND_API_KEY not set — skipping', { email });
    return;
  }

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: `Pagey <${process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'}>`,
      to: [ADMIN_ALERT_EMAIL],
      subject: `משתמש חדש נרשם: ${email}`,
      html: `<div style="font-family:sans-serif;font-size:15px;color:#1e293b;">
        <p>משתמש חדש נרשם למערכת Pagey:</p>
        <p style="font-weight:700;">${escapeHtml(email)}</p>
        <p style="color:#64748b;font-size:13px;">${new Date().toLocaleString('he-IL')}</p>
      </div>`,
    });
    console.log('[SIGNUP MAIL] sent', { email });
  } catch (err) {
    console.error('[SIGNUP MAIL] send failed', { email, err });
  }
}
