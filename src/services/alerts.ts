// Owner alerts: tells the founder when something breaks on the server, so a tester's complaint is
// not the first sign of trouble. OFF unless ALERTS_ENABLED=true.
//
// Channels (any combination): ALERT_WEBHOOK_URL (JSON POST, works with Slack/Discord/Make/Zapier
// style incoming webhooks) and email through Resend to ADMIN_ALERT_EMAIL (RESEND_API_KEY needed).
// Never throws, never blocks a request. Spam guard: the same alert key is sent at most once per
// 15 minutes and at most 30 alerts per hour overall. Messages carry only a short description
// (method + path without query string, status, a trimmed error line) — no bodies, tokens or emails.

import { Resend } from 'resend';

const SAME_KEY_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const HOURLY_MAX = 30;

export interface AlertSender { webhook(text: string): Promise<void>; email(subject: string, text: string): Promise<void> }

export function alertsEnabled(): boolean { return process.env.ALERTS_ENABLED === 'true'; }

const lastByKey = new Map<string, number>();
let hourStart = 0;
let hourCount = 0;

export function resetAlertState(): void { lastByKey.clear(); hourStart = 0; hourCount = 0; }

/** True when this alert may go out now (and records it). */
export function allowAlert(key: string, now = Date.now()): boolean {
  if (now - hourStart > HOUR_MS) { hourStart = now; hourCount = 0; }
  if (hourCount >= HOURLY_MAX) return false;
  const last = lastByKey.get(key);
  if (last !== undefined && now - last < SAME_KEY_MS) return false;
  if (lastByKey.size > 500) { for (const [k, t] of lastByKey) if (now - t > SAME_KEY_MS) lastByKey.delete(k); }
  lastByKey.set(key, now);
  hourCount += 1;
  return true;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const defaultSender: AlertSender = {
  async webhook(text) {
    const url = process.env.ALERT_WEBHOOK_URL;
    if (!url || !/^https:\/\//i.test(url)) return;
    // `text` is the Slack shape, `content` the Discord one; generic receivers just read the JSON.
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(5000) });
  },
  async email(subject, text) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return;
    const to = process.env.ADMIN_ALERT_EMAIL || 'tirnoer.digital@gmail.com';
    await new Resend(apiKey).emails.send({
      from: `Pagey <${process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev'}>`,
      to: [to], subject,
      html: `<div dir="rtl" style="font-family:sans-serif;font-size:15px;color:#1e293b;"><p>${escapeHtml(text)}</p><p style="color:#64748b;font-size:13px;">${new Date().toLocaleString('he-IL')}</p></div>`,
    });
  },
};

/** Fire-and-forget. `key` groups repeats of the same problem (default: the text itself). */
export async function notifyOwner(text: string, key?: string, sender: AlertSender = defaultSender): Promise<boolean> {
  if (!alertsEnabled()) return false;
  const msg = text.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!allowAlert(key ?? msg)) return false;
  const results = await Promise.allSettled([sender.webhook(`🚨 Pagey: ${msg}`), sender.email('Pagey: התראה מהשרת', msg)]);
  for (const r of results) if (r.status === 'rejected') console.error('[ALERT] send failed:', r.reason instanceof Error ? r.reason.message : r.reason);
  return true;
}

/** "GET /api/x?token=…" -> "GET /api/x" (query strings can hold secrets). */
export function describeRequest(method: string, originalUrl: string): string {
  return `${method} ${originalUrl.split('?')[0].slice(0, 120)}`;
}
