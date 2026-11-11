// Operational metrics for the admin "system health" tab (task #10).
//   - Google Places calls per month and SKU (places_usage, migration 040), against the free caps.
//   - Heartbeat of every background sweep (job_heartbeats).
//   - HTTP 5xx counts over the last hours (in memory, resets on redeploy: a live signal, not a record).
// Everything here is best-effort: a missing table (migration not run) or a DB error must never break the
// feature being measured, so every write swallows its errors.

import { supabase } from '../config/supabase';

export type PlacesSku = 'autocomplete' | 'details' | 'nearby';
export const PLACES_FREE_CAPS: Record<PlacesSku, number> = { autocomplete: 10000, details: 1000, nearby: 1000 };
export const PLACES_ALERT_AT = 0.8;

export const monthKey = (d = new Date()): string => d.toISOString().slice(0, 7);

export function placesSkuOf(url: string): PlacesSku | null {
  if (/\/places:autocomplete(\?|$)/.test(url)) return 'autocomplete';
  if (/\/places:searchNearby(\?|$)/.test(url)) return 'nearby';
  if (/\/places\/[^/:?]+(\?|$)/.test(url)) return 'details';
  return null;
}

const warned = new Set<string>();
/** Fire-and-forget. Never throws, never blocks the Places request. */
export function countPlacesCall(url: string, now = new Date()): void {
  const sku = placesSkuOf(url);
  if (!sku) return;
  void (async () => {
    try {
      const { error } = await supabase.rpc('bump_places_usage', { p_month: monthKey(now), p_sku: sku });
      if (error && !warned.has('places')) { warned.add('places'); console.warn('[OPS] places usage not recorded:', error.message); }
    } catch { /* best-effort */ }
  })();
}

export interface PlacesUsageRow { sku: PlacesSku; calls: number; cap: number; pct: number; alert: boolean }
export function placesUsageView(rows: { sku: string; calls: number | string }[]): PlacesUsageRow[] {
  return (Object.keys(PLACES_FREE_CAPS) as PlacesSku[]).map((sku) => {
    const calls = Number(rows.find((r) => r.sku === sku)?.calls ?? 0) || 0;
    const cap = PLACES_FREE_CAPS[sku];
    return { sku, calls, cap, pct: Math.round((calls / cap) * 100), alert: calls >= cap * PLACES_ALERT_AT };
  });
}
export async function readPlacesUsage(now = new Date()): Promise<{ rows: PlacesUsageRow[]; tracked: boolean }> {
  const { data, error } = await supabase.from('places_usage').select('sku, calls').eq('month', monthKey(now));
  if (error) return { rows: placesUsageView([]), tracked: false };
  return { rows: placesUsageView((data ?? []) as { sku: string; calls: number }[]), tracked: true };
}

// ── Job heartbeats ───────────────────────────────────────────────────────────
export async function recordHeartbeat(job: string, error: unknown | null, now = new Date()): Promise<void> {
  try {
    const { data } = await supabase.from('job_heartbeats').select('runs').eq('job', job).maybeSingle();
    const runs = Number((data as { runs?: number } | null)?.runs ?? 0) + 1;
    const iso = now.toISOString();
    const msg = error ? String(error instanceof Error ? error.message : error).slice(0, 300) : null;
    await supabase.from('job_heartbeats').upsert({
      job, last_run_at: iso, runs,
      ...(msg ? { last_error: msg, last_error_at: iso } : { last_ok_at: iso }),
    }, { onConflict: 'job' });
  } catch { /* best-effort */ }
}
/** Runs a sweep and records whether it finished. Errors are logged by the caller, not rethrown. */
export async function withHeartbeat(job: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn(); await recordHeartbeat(job, null); } catch (e) { await recordHeartbeat(job, e); throw e; }
}

export interface JobSpec { job: string; label: string; everyHours: number }
/** Sweeps and how often each is expected to run; `late` = no success for two periods. */
export const JOBS: JobSpec[] = [
  { job: 'digest', label: 'סיכום חודשי במייל', everyHours: 6 },
  { job: 'setup_reminder', label: 'תזכורת הקמה במייל', everyHours: 6 },
  { job: 'review_alerts', label: 'התראות ביקורות', everyHours: 6 },
  { job: 'subscriptions', label: 'מנויים (סליקה)', everyHours: 6 },
  { job: 'gbp_posts', label: 'פוסטים שבועיים לגוגל', everyHours: 3 },
  { job: 'auto_replies', label: 'תשובות לביקורות', everyHours: 3 },
];
export type JobStatus = 'ok' | 'late' | 'failing' | 'never';
export interface JobView { job: string; label: string; status: JobStatus; lastRunAt: string | null; lastOkAt: string | null; lastError: string | null; runs: number }
export function jobsView(rows: { job: string; last_run_at: string | null; last_ok_at: string | null; last_error: string | null; last_error_at: string | null; runs: number }[], enabled: Record<string, boolean>, now = new Date()): JobView[] {
  return JOBS.filter((j) => enabled[j.job] !== false).map((j) => {
    const r = rows.find((x) => x.job === j.job);
    if (!r) return { job: j.job, label: j.label, status: 'never' as const, lastRunAt: null, lastOkAt: null, lastError: null, runs: 0 };
    const okAge = r.last_ok_at ? now.getTime() - new Date(r.last_ok_at).getTime() : Infinity;
    const errNewer = !!r.last_error_at && (!r.last_ok_at || new Date(r.last_error_at) > new Date(r.last_ok_at));
    const status: JobStatus = errNewer ? 'failing' : okAge > j.everyHours * 2 * 3600000 ? 'late' : 'ok';
    return { job: j.job, label: j.label, status, lastRunAt: r.last_run_at, lastOkAt: r.last_ok_at, lastError: errNewer ? r.last_error : null, runs: Number(r.runs) || 0 };
  });
}
export async function readHeartbeats(): Promise<{ rows: Parameters<typeof jobsView>[0]; tracked: boolean }> {
  const { data, error } = await supabase.from('job_heartbeats').select('job, last_run_at, last_ok_at, last_error, last_error_at, runs');
  if (error) return { rows: [], tracked: false };
  return { rows: (data ?? []) as Parameters<typeof jobsView>[0], tracked: true };
}

// ── HTTP status counters (in memory) ─────────────────────────────────────────
const HOUR = 3600000;
const buckets = new Map<number, { total: number; s5xx: number }>();
export function recordHttp(status: number, now = Date.now()): void {
  const k = Math.floor(now / HOUR);
  const b = buckets.get(k) ?? { total: 0, s5xx: 0 };
  b.total += 1; if (status >= 500) b.s5xx += 1;
  buckets.set(k, b);
  if (buckets.size > 30) for (const key of buckets.keys()) if (key < k - 25) buckets.delete(key);
}
export function httpView(hours = 24, now = Date.now()): { hours: number; total: number; s5xx: number; ratePct: number } {
  const k = Math.floor(now / HOUR);
  let total = 0; let s5xx = 0;
  for (let i = 0; i < hours; i++) { const b = buckets.get(k - i); if (b) { total += b.total; s5xx += b.s5xx; } }
  return { hours, total, s5xx, ratePct: total ? Math.round((s5xx / total) * 1000) / 10 : 0 };
}
export function resetHttp(): void { buckets.clear(); }
