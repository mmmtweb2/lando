// System-health snapshot for the admin tab (task #10), and the hourly check that mails the owner when a
// threshold is crossed (through the existing alerts channel: OFF unless ALERTS_ENABLED=true).
// Read-only. Every source degrades to "unknown" instead of failing the whole snapshot.

import { supabase } from '../config/supabase';
import { notifyOwner } from './alerts';
import { digestEnabled } from './digest.service';
import { reminderEnabled } from './setupReminder.service';
import { reviewAlertsEnabled } from './reviewAlerts.service';
import { httpView, jobsView, readHeartbeats, readPlacesUsage, type JobView, type PlacesUsageRow } from './opsMetrics.service';
import type { AlertItem } from './adminOps';

export const HTTP_ALERT_RATE_PCT = 5;
export const HTTP_ALERT_MIN_REQUESTS = 20;
const DAY = 86400000;

export interface HealthSnapshot {
  at: string;
  db: { ok: boolean; ms: number | null };
  places: { rows: PlacesUsageRow[]; tracked: boolean };
  jobs: { rows: JobView[]; tracked: boolean };
  gbp: { connections: number; needsReconnect: number; quota: 'pending' | 'ok' | 'unknown'; lastError: string | null; oldestConnectionDays: number | null };
  sumit: { webhookFailing: boolean; lastWebhookOkAt: string | null; lastWebhookError: string | null; chargeFailed7d: number; needAttention: number };
  http: ReturnType<typeof httpView>;
  alerts: AlertItem[];
}

const count = async (q: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> => { try { const r = await q; return r.error ? null : r.count ?? 0; } catch { return null; } };

export async function healthSnapshot(now = new Date()): Promise<HealthSnapshot> {
  const t0 = Date.now();
  let dbOk = false;
  try { const { error } = await supabase.from('user_profiles').select('email', { head: true, count: 'exact' }).limit(1); dbOk = !error; } catch { dbOk = false; }
  const dbMs = Date.now() - t0;

  const [places, hb] = await Promise.all([readPlacesUsage(now), readHeartbeats()]);
  const jobs = jobsView(hb.rows, { digest: digestEnabled(), setup_reminder: reminderEnabled(), review_alerts: reviewAlertsEnabled() }, now);
  const gbpHb = hb.rows.find((r) => r.job === 'gbp_google');
  const sumitHb = hb.rows.find((r) => r.job === 'sumit_webhook');

  let connections = 0; let needsReconnect = 0; let oldest: number | null = null;
  try {
    const { data } = await supabase.from('gbp_connections').select('status, connected_at');
    const rows = (data ?? []) as { status: string; connected_at: string }[];
    connections = rows.length; needsReconnect = rows.filter((r) => r.status === 'needs_reconnect').length;
    if (rows.length) oldest = Math.floor((now.getTime() - Math.min(...rows.map((r) => new Date(r.connected_at).getTime()))) / DAY);
  } catch { /* unknown */ }
  const gbpErrNewer = !!gbpHb?.last_error_at && (!gbpHb.last_ok_at || new Date(gbpHb.last_error_at) > new Date(gbpHb.last_ok_at));
  const quota: 'pending' | 'ok' | 'unknown' = !gbpHb ? 'unknown' : gbpErrNewer && /quota/i.test(gbpHb.last_error ?? '') ? 'pending' : gbpHb.last_ok_at && !gbpErrNewer ? 'ok' : 'unknown';

  const since7 = new Date(now.getTime() - 7 * DAY).toISOString();
  const chargeFailed7d = (await count(supabase.from('seo_subscription_events').select('id', { head: true, count: 'exact' }).eq('kind', 'charge_failed').gte('created_at', since7))) ?? 0;
  const needAttention = (await count(supabase.from('seo_subscriptions').select('id', { head: true, count: 'exact' }).or('needs_manual_cancel.eq.true,status.eq.past_due'))) ?? 0;
  const webhookFailing = !!sumitHb?.last_error_at && (now.getTime() - new Date(sumitHb.last_error_at).getTime() < 7 * DAY) && (!sumitHb.last_ok_at || new Date(sumitHb.last_error_at) > new Date(sumitHb.last_ok_at));

  const http = httpView(24);
  const alerts: AlertItem[] = [];
  if (!dbOk) alerts.push({ level: 'bad', text: 'בסיס הנתונים לא עונה.', tab: 'system' });
  for (const p of places.rows) if (p.alert) alerts.push({ level: p.pct >= 100 ? 'bad' : 'warn', text: `Places (${p.sku}): ${p.calls} מתוך ${p.cap} החודש (${p.pct}%).`, tab: 'system' });
  for (const j of jobs) if (j.status === 'failing' || j.status === 'late') alerts.push({ level: j.status === 'failing' ? 'bad' : 'warn', text: `${j.label}: ${j.status === 'failing' ? 'נכשל בריצה האחרונה' : 'לא רץ בזמן'}.`, tab: 'system' });
  if (needsReconnect > 0) alerts.push({ level: 'warn', text: `${needsReconnect} חיבורי גוגל דורשים חיבור מחדש.`, tab: 'system' });
  if (webhookFailing) alerts.push({ level: 'bad', text: 'ה-webhook של SUMIT נכשל לאחרונה.', tab: 'system' });
  if (needAttention > 0) alerts.push({ level: 'warn', text: `${needAttention} מנויים דורשים טיפול (חיוב שנכשל או ביטול ידני).`, tab: 'revenue' });
  if (http.total >= HTTP_ALERT_MIN_REQUESTS && http.ratePct >= HTTP_ALERT_RATE_PCT) alerts.push({ level: 'bad', text: `שגיאות 5xx: ${http.ratePct}% מהבקשות ב-24 שעות.`, tab: 'system' });

  return {
    at: now.toISOString(), db: { ok: dbOk, ms: dbMs }, places, jobs: { rows: jobs, tracked: hb.tracked },
    gbp: { connections, needsReconnect, quota, lastError: gbpErrNewer ? gbpHb?.last_error ?? null : null, oldestConnectionDays: oldest },
    sumit: { webhookFailing, lastWebhookOkAt: sumitHb?.last_ok_at ?? null, lastWebhookError: webhookFailing ? sumitHb?.last_error ?? null : null, chargeFailed7d, needAttention },
    http, alerts,
  };
}

/** Sends one owner alert per kind of problem (alerts.ts limits repeats to one per 15 minutes; this runs hourly). */
export async function checkHealthAlerts(now = new Date(), snap?: HealthSnapshot, send = notifyOwner): Promise<number> {
  const s = snap ?? (await healthSnapshot(now));
  let sent = 0;
  for (const a of s.alerts) if (a.level === 'bad' || /Places/.test(a.text)) { if (await send(`בדיקת מערכת: ${a.text}`, `health:${a.text.slice(0, 40)}`)) sent++; }
  return sent;
}

const EVERY_MS = 60 * 60 * 1000;
export function startHealthAlertSweep(): void {
  if (process.env.ALERTS_ENABLED !== 'true') return;
  const run = () => { checkHealthAlerts().catch((e) => console.error('[HEALTH] check crashed:', e instanceof Error ? e.message : e)); };
  setTimeout(run, 10 * 60 * 1000).unref?.();
  setInterval(run, EVERY_MS).unref?.();
}
