// The sender line at the bottom of Pagey's own emails (legal audit 16.11: every email says who sent it
// and how to reach us). Mirrors the contact details of client/src/config/operator.ts; the operator's
// legal name and business number are added there once Moshe fills them in, not guessed here.

export const SENDER_NAME = 'Pagey';
export const SENDER_SITE = 'pagey.co.il';
export const SENDER_EMAIL = 'tirnoer.digital@gmail.com';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One centred footer paragraph: sender + contact, and an unsubscribe link when the email has one. */
export function senderFooterHtml(opts: { unsubUrl?: string | null; reason?: string } = {}): string {
  const reason = opts.reason ? `${esc(opts.reason)}<br>` : '';
  const unsub = opts.unsubUrl
    ? `<br><a href="${esc(opts.unsubUrl)}" style="color:#64748b;text-decoration:underline;">להפסקת הודעות מהסוג הזה</a>`
    : '';
  return `<p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;text-align:center;">${reason}נשלח מ-${SENDER_NAME} (${SENDER_SITE}) · לשאלות: <a href="mailto:${SENDER_EMAIL}" style="color:#64748b;">${SENDER_EMAIL}</a>${unsub}</p>`;
}

/** Plain-text equivalent, for the text part of an email. */
export function senderFooterText(unsubUrl?: string | null): string {
  return `נשלח מ-${SENDER_NAME} (${SENDER_SITE}) · לשאלות: ${SENDER_EMAIL}${unsubUrl ? `\nלהפסקת הודעות מהסוג הזה: ${unsubUrl}` : ''}`;
}
