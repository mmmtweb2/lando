// Pure calculations behind the admin tabs of the Google-promotion product (task #10). No I/O here:
// the controller loads the rows, these functions turn them into what each tab shows, so they can be
// tested with plain arrays. Only account-level data is used (emails stay on the admin side).

import { isEntitled } from './entitlements.service';

export const MRR_GOAL_ILS = 2500;
export const STUCK_AFTER_HOURS = 48;
const DAY = 86400000;

export interface JourneyR { email: string; stage: 'registered' | 'setup' | 'ready_to_activate'; source: string | null; utm_source: string | null; registered_at: string; setup_at: string | null; ready_at: string | null; activation_requested_at: string | null; beta_activated_at: string | null; updated_at: string | null; profile_state?: 'pending_verification' | null; pending_name?: string | null }
export interface ProductR { email: string; status: string; current_period_end: string | null; source: string }
export interface SubR { email: string; status: string; amount: number | string; created_at: string; cancel_at_period_end: boolean; needs_manual_cancel: boolean }
export interface SubEventR { kind: string; created_at: string }
export interface PremiumR { email: string; status: 'active' | 'paused' | 'ended'; last_card_update: string | null; monthly_price: number | string | null; note: string | null }
export interface EventR { event: string; email: string | null; anon_id: string | null; props: Record<string, unknown> | null; created_at: string }

const t = (iso: string | null | undefined): number | null => (iso ? new Date(iso).getTime() : null);
const num = (v: number | string | null | undefined): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const round1 = (n: number) => Math.round(n * 10) / 10;
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

// ── Account state ────────────────────────────────────────────────────────────
export type AccountState = 'registered' | 'setup' | 'ready_to_activate' | 'active_beta' | 'active';
export function entitlementMap(products: ProductR[], now: Date): Map<string, 'beta' | 'paid'> {
  const m = new Map<string, 'beta' | 'paid'>();
  for (const p of products) if (isEntitled(p, now)) m.set(p.email, p.source === 'sumit' ? 'paid' : 'beta');
  return m;
}
export const stateOf = (j: JourneyR, ent: 'beta' | 'paid' | undefined): AccountState =>
  (ent === 'paid' ? 'active' : ent === 'beta' ? 'active_beta' : j.stage);

export function lastProgressAt(j: JourneyR): number {
  return Math.max(...[j.registered_at, j.setup_at, j.ready_at, j.activation_requested_at, j.beta_activated_at, j.updated_at].map(t).filter((x): x is number => x !== null));
}
/** Registered or in setup, and nothing has moved for STUCK_AFTER_HOURS. */
export function isStuck(j: JourneyR, state: AccountState, now: Date): boolean {
  return (state === 'registered' || state === 'setup') && now.getTime() - lastProgressAt(j) > STUCK_AFTER_HOURS * 3600000;
}

// ── MRR ──────────────────────────────────────────────────────────────────────
export function mrr(subs: SubR[], premium: PremiumR[]) {
  const paying = subs.filter((s) => s.status === 'active' || s.status === 'past_due');
  const sumit = paying.reduce((a, s) => a + num(s.amount), 0);
  // Manual premium counts only while it is active and has a price written down.
  const manualRows = premium.filter((p) => p.status === 'active' && p.monthly_price !== null && num(p.monthly_price) > 0);
  const manual = manualRows.reduce((a, p) => a + num(p.monthly_price), 0);
  const total = sumit + manual;
  return { sumit, manual, total, goal: MRR_GOAL_ILS, goalPct: Math.min(100, Math.round((total / MRR_GOAL_ILS) * 100)), payingCount: paying.length, manualPayingCount: manualRows.length };
}

// ── Overview ─────────────────────────────────────────────────────────────────
export interface AlertItem { level: 'warn' | 'bad'; text: string; tab?: string }
export interface OverviewInput { journeys: JourneyR[]; products: ProductR[]; subs: SubR[]; premium: PremiumR[]; alerts: AlertItem[]; now: Date }
export function overview(i: OverviewInput) {
  const now = i.now.getTime();
  const ents = entitlementMap(i.products, i.now);
  const wk = (from: number, to: number, f: (j: JourneyR) => string | null) => i.journeys.filter((j) => { const x = t(f(j)); return x !== null && x >= from && x < to; }).length;
  const signupsWeek = wk(now - 7 * DAY, now + 1, (j) => j.registered_at);
  const signupsPrev = wk(now - 14 * DAY, now - 7 * DAY, (j) => j.registered_at);
  const setupsWeek = wk(now - 7 * DAY, now + 1, (j) => j.ready_at);
  const states = i.journeys.map((j) => stateOf(j, ents.get(j.email)));
  const stuck = i.journeys.filter((j, k) => isStuck(j, states[k], i.now)).length;
  const m = mrr(i.subs, i.premium);
  return {
    signupsWeek, signupsPrev,
    setupsCompleted: i.journeys.filter((j) => j.ready_at).length, setupsWeek,
    activeBeta: states.filter((s) => s === 'active_beta').length, activePaid: states.filter((s) => s === 'active').length,
    stuck, mrr: m, manualPremiumActive: i.premium.filter((p) => p.status === 'active').length,
    alerts: i.alerts,
  };
}

// ── Funnel ───────────────────────────────────────────────────────────────────
const hoursBetween = (a: string | null, b: string | null): number | null => { const x = t(a); const y = t(b); return x !== null && y !== null && y >= x ? (y - x) / 3600000 : null; };
export function isoWeekStart(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - x.getUTCDay()); // Sunday = start of the Israeli week
  return x.toISOString().slice(0, 10);
}
export const sourceOf = (j: Pick<JourneyR, 'source' | 'utm_source'>): string => (j.utm_source || j.source || 'ישיר').slice(0, 40);

export function funnel(journeys: JourneyR[], events: EventR[], products: ProductR[], now: Date, weeks = 8) {
  const ents = entitlementMap(products, now);
  const paidAt = new Map<string, string>();
  for (const e of events) if (e.event === 'payment_succeeded' && e.email) paidAt.set(e.email, e.created_at);
  const activatedAt = (j: JourneyR): string | null => {
    const a = [j.beta_activated_at, paidAt.get(j.email) ?? null].filter((x): x is string => !!x).sort();
    return a[0] ?? (ents.has(j.email) ? j.updated_at : null);
  };
  const audits = new Set(events.filter((e) => e.event === 'audit_completed' && e.anon_id).map((e) => e.anon_id as string)).size;
  const counts = {
    registered: journeys.length,
    setup: journeys.filter((j) => j.setup_at).length,
    ready: journeys.filter((j) => j.ready_at).length,
    activated: journeys.filter((j) => activatedAt(j)).length,
  };
  const stages = [
    { key: 'audit', label: 'סיימו בדיקת Audit', n: audits, conv: null as number | null },
    { key: 'registered', label: 'נרשמו', n: counts.registered, conv: counts.registered <= audits ? pct(counts.registered, audits) : null },
    { key: 'setup', label: 'התחילו הקמה', n: counts.setup, conv: pct(counts.setup, counts.registered) },
    { key: 'ready', label: 'סיימו הקמה', n: counts.ready, conv: pct(counts.ready, counts.setup) },
    { key: 'activated', label: 'הופעלו', n: counts.activated, conv: pct(counts.activated, counts.ready) },
  ];
  const med = (f: (j: JourneyR) => number | null) => { const m = median(journeys.map(f).filter((x): x is number => x !== null)); return m === null ? null : round1(m); };
  const medianHours = {
    registeredToSetup: med((j) => hoursBetween(j.registered_at, j.setup_at)),
    setupToReady: med((j) => hoursBetween(j.setup_at, j.ready_at)),
    readyToActivated: med((j) => hoursBetween(j.ready_at, activatedAt(j))),
  };
  const bySourceMap = new Map<string, { registered: number; setup: number; ready: number; activated: number }>();
  const weekMap = new Map<string, { registered: number; setup: number; ready: number; activated: number }>();
  const bump = (m: typeof bySourceMap, k: string, j: JourneyR) => {
    const r = m.get(k) ?? { registered: 0, setup: 0, ready: 0, activated: 0 };
    r.registered++; if (j.setup_at) r.setup++; if (j.ready_at) r.ready++; if (activatedAt(j)) r.activated++;
    m.set(k, r);
  };
  for (const j of journeys) { bump(bySourceMap, sourceOf(j), j); bump(weekMap, isoWeekStart(new Date(j.registered_at)), j); }
  const bySource = [...bySourceMap].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.registered - a.registered);
  const cohorts = [...weekMap].map(([week, v]) => ({ week, ...v })).sort((a, b) => (a.week < b.week ? 1 : -1)).slice(0, weeks);
  return { stages, medianHours, bySource, cohorts };
}

// ── Users ────────────────────────────────────────────────────────────────────
export interface UserRow {
  email: string; state: AccountState; stage: string; registeredAt: string; lastProgressAt: string; stuck: boolean; source: string;
  premium: { status: string; lastCardUpdate: string | null; monthlyPrice: number | null; note: string | null } | null;
  /** No verified Google profile yet (task #12): the owner is creating or verifying it. */
  profilePending: boolean; pendingName: string | null;
}
export function users(journeys: JourneyR[], products: ProductR[], premium: PremiumR[], now: Date): UserRow[] {
  const ents = entitlementMap(products, now);
  const prem = new Map(premium.map((p) => [p.email, p]));
  return journeys.map((j) => {
    const state = stateOf(j, ents.get(j.email));
    const p = prem.get(j.email);
    return {
      email: j.email, state, stage: j.stage, registeredAt: j.registered_at, lastProgressAt: new Date(lastProgressAt(j)).toISOString(),
      stuck: isStuck(j, state, now), source: sourceOf(j),
      profilePending: j.profile_state === 'pending_verification', pendingName: j.profile_state === 'pending_verification' ? j.pending_name ?? null : null,
      premium: p ? { status: p.status, lastCardUpdate: p.last_card_update, monthlyPrice: p.monthly_price === null ? null : num(p.monthly_price), note: p.note } : null,
    };
  }).sort((a, b) => (a.registeredAt < b.registeredAt ? 1 : -1));
}
/** Premium rows for accounts that are not (yet) in the journey list also need to be visible. */
export function premiumOnly(journeys: JourneyR[], premium: PremiumR[]): PremiumR[] {
  const have = new Set(journeys.map((j) => j.email));
  return premium.filter((p) => !have.has(p.email));
}

// ── Revenue ──────────────────────────────────────────────────────────────────
export function revenue(i: { journeys: JourneyR[]; products: ProductR[]; subs: SubR[]; premium: PremiumR[]; now: Date }) {
  const ents = entitlementMap(i.products, i.now);
  const m = mrr(i.subs, i.premium);
  const activeNow = i.subs.filter((s) => s.status === 'active' || s.status === 'past_due').length;
  const betaStarted = i.journeys.filter((j) => j.beta_activated_at).length;
  const betaToPaid = i.journeys.filter((j) => j.beta_activated_at && ents.get(j.email) === 'paid').length;
  const readyToPay = i.journeys.filter((j) => ents.get(j.email) === 'beta').length;
  const plans = new Map<number, number>();
  for (const s of i.subs.filter((x) => x.status === 'active' || x.status === 'past_due')) plans.set(num(s.amount), (plans.get(num(s.amount)) ?? 0) + 1);
  return {
    mrr: m, payingCustomers: activeNow, plans: [...plans].map(([amount, n]) => ({ amount, n })).sort((a, b) => b.n - a.n),
    betaStarted, betaToPaid, betaToPaidPct: pct(betaToPaid, betaStarted), readyToPay,
    subsNeedingAttention: i.subs.filter((s) => s.needs_manual_cancel || s.status === 'past_due').length,
  };
}
/** Churn over the last 30 days = canceled events / (active now + canceled in the window). */
export function churn30(events: SubEventR[], activeNow: number, now: Date): { canceled: number; pct: number | null } {
  const since = now.getTime() - 30 * DAY;
  const canceled = events.filter((e) => e.kind === 'canceled' && new Date(e.created_at).getTime() >= since).length;
  return { canceled, pct: pct(canceled, activeNow + canceled) };
}

// ── Manual premium input ─────────────────────────────────────────────────────
export interface PremiumInput { email: string; status: 'active' | 'paused' | 'ended'; lastCardUpdate: string | null; monthlyPrice: number | null; note: string | null }
export type PremiumParse = { ok: true; value: PremiumInput } | { ok: false; error: string };
export function parsePremium(b: unknown, now = new Date()): PremiumParse {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const email = typeof o.email === 'string' ? o.email.trim().toLowerCase() : '';
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email)) return { ok: false, error: 'כתובת מייל לא תקינה.' };
  if (o.status !== 'active' && o.status !== 'paused' && o.status !== 'ended') return { ok: false, error: 'סטטוס לא תקין.' };
  let lastCardUpdate: string | null = null;
  if (o.lastCardUpdate !== null && o.lastCardUpdate !== undefined && o.lastCardUpdate !== '') {
    const s = String(o.lastCardUpdate);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null;
    if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return { ok: false, error: 'תאריך עדכון לא תקין.' };
    if (d.getTime() > now.getTime() + DAY) return { ok: false, error: 'תאריך העדכון לא יכול להיות בעתיד.' };
    lastCardUpdate = s;
  }
  let monthlyPrice: number | null = null;
  if (o.monthlyPrice !== null && o.monthlyPrice !== undefined && o.monthlyPrice !== '') {
    const n = Number(o.monthlyPrice);
    if (!Number.isFinite(n) || n < 0 || n > 100000) return { ok: false, error: 'מחיר חודשי לא תקין.' };
    monthlyPrice = Math.round(n * 100) / 100;
  }
  const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, 300) : null;
  return { ok: true, value: { email, status: o.status, lastCardUpdate, monthlyPrice, note } };
}

// ── Feedback signals from the event log ──────────────────────────────────────
export function feedbackSignals(events: EventR[], now: Date) {
  const since = now.getTime() - 30 * DAY;
  const recent = events.filter((e) => new Date(e.created_at).getTime() >= since);
  const top = new Map<string, number>();
  for (const e of recent) if (e.event === 'recs_viewed' && typeof e.props?.top === 'string') top.set(e.props.top as string, (top.get(e.props.top as string) ?? 0) + 1);
  return {
    conciergeClicks30: recent.filter((e) => e.event === 'concierge_clicked').length,
    topRecommendations: [...top].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n).slice(0, 8),
  };
}
