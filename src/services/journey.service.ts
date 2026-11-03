// The customer journey of the Google-promotion product (task #9, migration 039):
//   registered -> setup -> ready_to_activate -> active_beta | active
// The first three are stored (seo_journey.stage). The last two are DERIVED from the entitlement
// (user_products): a manual/beta grant is active_beta, a paying SUMIT subscription is active. So
// switching the payment gate on or off changes behaviour, never the data model.
//
// Also the server-side event log (journey_events). Rules: no names/phones/emails in props (only a
// small allow-list of keys), milestones count once per account, logging never throws or blocks.

import { supabase } from '../config/supabase';
import { isEntitled } from './entitlements.service';
import { grantAccess } from './betaAccess.service';

// ── Switches ─────────────────────────────────────────────────────────────────
/** On: activation means paying (SUMIT). Off (default): activation is the free beta. */
export function paymentGateEnabled(): boolean { return process.env.PAYMENT_GATE_ENABLED === 'true'; }
/** Beta activation by the customer alone. Off (default): the request is recorded and the owner grants access. */
export function betaSelfActivation(): boolean { return process.env.BETA_SELF_ACTIVATION === 'true'; }
export function betaDays(): number {
  const n = Number(process.env.BETA_ACTIVATION_DAYS);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : 90;
}

// ── Events ───────────────────────────────────────────────────────────────────
export const PUBLIC_EVENTS = ['audit_started', 'audit_completed', 'recs_viewed', 'concierge_clicked'] as const;
export const ACCOUNT_EVENTS = ['recs_viewed', 'activation_viewed', 'setup_step_completed', 'dashboard_viewed', 'concierge_clicked'] as const;
export const SERVER_EVENTS = [
  'lead_captured', 'signup', 'setup_completed', 'activation_requested', 'activated_beta',
  'payment_started', 'payment_succeeded', 'day7_active', 'day30_active',
] as const;
export type JourneyEvent = (typeof PUBLIC_EVENTS)[number] | (typeof ACCOUNT_EVENTS)[number] | (typeof SERVER_EVENTS)[number];

const isIn = (list: readonly string[], v: unknown): v is string => typeof v === 'string' && list.includes(v);
export const isPublicEvent = (v: unknown) => isIn(PUBLIC_EVENTS, v);
export const isAccountEvent = (v: unknown) => isIn(ACCOUNT_EVENTS, v);

const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
const ANON_ID = /^[A-Za-z0-9_-]{8,64}$/;
const WORD = /^[a-z0-9_]{1,40}$/;
const UTM = /^[\w .\-+%]{1,100}$/;

export const validAnonId = (v: unknown): string | null => (typeof v === 'string' && ANON_ID.test(v) ? v : null);

/** Keeps only known, harmless keys. Anything else (names, phones, emails, free text) is dropped. */
export function cleanProps(raw: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const o = raw as Record<string, unknown>;
  if (typeof o.step_id === 'string' && WORD.test(o.step_id)) out.step_id = o.step_id;
  if (typeof o.mode === 'string' && WORD.test(o.mode)) out.mode = o.mode;
  if (typeof o.top === 'string' && WORD.test(o.top)) out.top = o.top; // the biggest gap found (a recommendation key)
  if (typeof o.place_id === 'string' && PLACE_ID.test(o.place_id)) out.place_id = o.place_id;
  if (typeof o.n === 'number' && Number.isFinite(o.n) && o.n >= 0 && o.n <= 1000) out.n = Math.round(o.n);
  if (typeof o.ok === 'boolean') out.ok = o.ok;
  return out;
}

export interface Attribution { source: string | null; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null }
export function cleanAttribution(raw: unknown): Attribution {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === 'string' && UTM.test(v) ? v : null);
  return { source: pick(o.source), utm_source: pick(o.utm_source), utm_medium: pick(o.utm_medium), utm_campaign: pick(o.utm_campaign) };
}

export interface EventInput {
  event: JourneyEvent; email?: string | null; anonId?: string | null; props?: unknown; attribution?: unknown;
}

/** Fire-and-forget. A duplicate milestone (unique index) is expected and silent. Returns whether a row was written. */
export async function logEvent(e: EventInput): Promise<boolean> {
  try {
    const a = cleanAttribution(e.attribution);
    const { error } = await supabase.from('journey_events').insert({
      event: e.event, email: e.email ?? null, anon_id: validAnonId(e.anonId), props: cleanProps(e.props), ...a,
    });
    if (!error) return true;
    if (error.code === '23505') return false;
    if (error.code !== '42P01') console.error('[JOURNEY] event failed:', error.message);
    return false;
  } catch (err) {
    console.error('[JOURNEY] event crashed:', err instanceof Error ? err.message : err);
    return false;
  }
}

// ── State ────────────────────────────────────────────────────────────────────
export type Stage = 'registered' | 'setup' | 'ready_to_activate';
export type JourneyState = Stage | 'active_beta' | 'active';

export function deriveState(stage: Stage, ent: { entitled: boolean; source: string | null }): JourneyState {
  if (!ent.entitled) return stage;
  return ent.source === 'sumit' ? 'active' : 'active_beta';
}

export interface JourneyRow {
  email: string; stage: Stage; place_id: string | null; anon_id: string | null;
  registered_at: string; setup_at: string | null; ready_at: string | null;
  activation_requested_at: string | null; beta_activated_at: string | null;
}
const COLS = 'email, stage, place_id, anon_id, registered_at, setup_at, ready_at, activation_requested_at, beta_activated_at';

export class JourneyError extends Error {
  constructor(public readonly code: 'not_migrated' | 'bad_place' | 'no_business' | 'not_ready' | 'payment_required' | 'beta_ended' | 'db', message?: string) { super(message ?? code); }
}
const missing = (m?: string) => /does not exist|schema cache|42P01|PGRST205/i.test(m ?? '');
const dbErr = (e: { message: string }) => (missing(e.message) ? new JourneyError('not_migrated') : new JourneyError('db', e.message));

export async function entitlementOf(email: string, now = new Date()): Promise<{ entitled: boolean; source: string | null }> {
  const { data, error } = await supabase.from('user_products').select('status, current_period_end, source')
    .eq('email', email).eq('product', 'seo_autopilot').maybeSingle();
  if (error) throw new JourneyError('db', error.message);
  const r = data as { status: string; current_period_end: string | null; source: string } | null;
  return r && isEntitled(r, now) ? { entitled: true, source: r.source } : { entitled: false, source: null };
}

export async function getRow(email: string): Promise<JourneyRow | null> {
  const { data, error } = await supabase.from('seo_journey').select(COLS).eq('email', email).maybeSingle();
  if (error) throw dbErr(error);
  return (data as JourneyRow | null) ?? null;
}

export interface Gates { paymentGate: boolean; betaSelfActivation: boolean }
export const gates = (): Gates => ({ paymentGate: paymentGateEnabled(), betaSelfActivation: betaSelfActivation() });

export interface JourneyView {
  state: JourneyState; placeId: string | null; requested: boolean; started: boolean; gates: Gates;
}

async function view(email: string, row: JourneyRow | null, now: Date): Promise<JourneyView> {
  const ent = await entitlementOf(email, now);
  return {
    state: deriveState(row?.stage ?? 'registered', ent),
    placeId: row?.place_id ?? null,
    requested: !!row?.activation_requested_at,
    started: !!row,
    gates: gates(),
  };
}

/** Read-only: never creates a row (used by the dashboard banner). */
export async function peek(email: string, now = new Date()): Promise<JourneyView> {
  return view(email, await getRow(email), now);
}

/** Starts the journey (idempotent). The `signup` event is logged once, and only for accounts that are not already customers. */
export async function start(email: string, anonId: string | null, attribution: unknown, now = new Date()): Promise<JourneyView> {
  let row = await getRow(email);
  if (!row) {
    const a = cleanAttribution(attribution);
    const { error } = await supabase.from('seo_journey').insert({ email, anon_id: validAnonId(anonId), ...a, registered_at: now.toISOString() });
    if (error && error.code !== '23505') throw dbErr(error);
    row = await getRow(email);
    const ent = await entitlementOf(email, now);
    if (!ent.entitled) await logEvent({ event: 'signup', email, anonId, attribution });
  }
  return view(email, row, now);
}

const touch = (patch: Record<string, unknown>) => ({ ...patch, updated_at: new Date().toISOString() });

/** Step 1: the business (a Google place id only). registered -> setup. Changing it later keeps the stage. */
export async function setBusiness(email: string, placeId: unknown, now = new Date()): Promise<JourneyView> {
  if (typeof placeId !== 'string' || !PLACE_ID.test(placeId)) throw new JourneyError('bad_place');
  const row = (await getRow(email)) ?? (await (async () => { await start(email, null, null, now); return getRow(email); })());
  const patch: Record<string, unknown> = { place_id: placeId };
  if (row && row.stage === 'registered') { patch.stage = 'setup'; patch.setup_at = now.toISOString(); }
  const { error } = await supabase.from('seo_journey').update(touch(patch)).eq('email', email);
  if (error) throw dbErr(error);
  await logEvent({ event: 'setup_step_completed', email, props: { step_id: 'business' } });
  return view(email, await getRow(email), now);
}

/** Step 2: the customer went through the recommendations. setup -> ready_to_activate. */
export async function completeSetup(email: string, now = new Date()): Promise<JourneyView> {
  const row = await getRow(email);
  if (!row || !row.place_id) throw new JourneyError('no_business');
  if (row.stage !== 'ready_to_activate') {
    const { error } = await supabase.from('seo_journey').update(touch({ stage: 'ready_to_activate', ready_at: now.toISOString() })).eq('email', email);
    if (error) throw dbErr(error);
  }
  await logEvent({ event: 'setup_completed', email });
  return view(email, await getRow(email), now);
}

export type ActivateResult = JourneyView & { requested: boolean };

/**
 * Step 3. Payment gate ON -> never free (the customer pays through the subscription flow and
 * becomes `active` only after SUMIT's verified payment). OFF -> free beta: with BETA_SELF_ACTIVATION
 * the customer is activated now; without it the request is recorded and the owner grants access.
 */
export async function activate(email: string, now = new Date()): Promise<ActivateResult> {
  const ent = await entitlementOf(email, now);
  const row = await getRow(email);
  if (ent.entitled) return { ...(await view(email, row, now)), requested: !!row?.activation_requested_at };
  if (!row || row.stage !== 'ready_to_activate') throw new JourneyError('not_ready');
  if (paymentGateEnabled()) throw new JourneyError('payment_required');

  if (!betaSelfActivation()) {
    if (!row.activation_requested_at) {
      const { error } = await supabase.from('seo_journey').update(touch({ activation_requested_at: now.toISOString() })).eq('email', email);
      if (error) throw dbErr(error);
      await logEvent({ event: 'activation_requested', email });
    }
    return { ...(await view(email, await getRow(email), now)), requested: true };
  }

  // The free beta is single-use: once it has run out, a new click must not grant another round.
  if (row.beta_activated_at) throw new JourneyError('beta_ended');
  await grantAccess(email, betaDays(), now);
  const { error } = await supabase.from('seo_journey').update(touch({ beta_activated_at: now.toISOString() })).eq('email', email);
  if (error) throw dbErr(error);
  await logEvent({ event: 'activated_beta', email });
  return { ...(await view(email, await getRow(email), now)), requested: false };
}

/** day7_active / day30_active: the first dashboard visit that happens 7 (or 30) days or more after registration. */
export function dayMilestone(registeredAt: string, now: Date): 'day7_active' | 'day30_active' | null {
  const days = (now.getTime() - Date.parse(registeredAt)) / 86_400_000;
  if (!(days >= 7)) return null;
  return days >= 30 ? 'day30_active' : 'day7_active';
}

export async function recordDashboardView(email: string, now = new Date()): Promise<void> {
  await logEvent({ event: 'dashboard_viewed', email });
  const row = await getRow(email).catch(() => null);
  if (!row) return;
  const m = dayMilestone(row.registered_at, now);
  if (m) await logEvent({ event: m, email });
  // A visit at 30+ days also counts as having been active at 7+ days.
  if (m === 'day30_active') await logEvent({ event: 'day7_active', email });
}
