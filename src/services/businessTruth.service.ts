// Storage and Google sync for the business card (docs/mvp-plan.md, A1; migration 048).
// The pure rules live in businessTruth.ts.

import { supabase } from '../config/supabase';
import { GbpError, fetchLocationDetail, listLocations, patchLocation, pickLocation } from './gbpGoogle';
import { getConnection, markNeedsReconnect, setLocation } from './gbpStore';
import { listBusinesses } from './seoBusinesses.service';
import { accessFor } from './reviewAlerts.service';
import { logActivity, missingTable, setAutomation } from './automation.service';
import { type Readiness, type TruthCard, applyEdit, emptyCard, mergeFromGoogle, parseLocation, readiness, writeBackPlan } from './businessTruth';

export class TruthError extends Error {
  constructor(public readonly code: 'not_connected' | 'no_location' | 'not_migrated' | 'not_found' | 'not_ready' | 'quota_pending' | 'google', message = code) { super(message); }
}

export interface TruthView { card: TruthCard; readiness: Readiness; fetchedAt: string | null; approvedAt: string | null; location: string | null }
interface Row { owner_email: string; location_name: string | null; card: TruthCard; fetched_at: string | null; approved_at: string | null }
const COLS = 'owner_email, location_name, card, fetched_at, approved_at';

const view = (r: Row): TruthView => {
  const card = { ...emptyCard(), ...(r.card ?? {}) };
  return { card, readiness: readiness(card), fetchedAt: r.fetched_at, approvedAt: r.approved_at, location: r.location_name };
};

async function getRow(email: string): Promise<Row | null> {
  const { data, error } = await supabase.from('business_truth').select(COLS).eq('owner_email', email).maybeSingle();
  if (error) { if (missingTable(error.message, error.code)) throw new TruthError('not_migrated'); throw new Error(error.message); }
  return (data as Row | null) ?? null;
}

async function putRow(row: Partial<Row> & { owner_email: string }, now: Date): Promise<void> {
  const { error } = await supabase.from('business_truth').upsert({ ...row, updated_at: now.toISOString() }, { onConflict: 'owner_email' });
  if (error) { if (missingTable(error.message, error.code)) throw new TruthError('not_migrated'); throw new Error(error.message); }
}

export async function getTruth(email: string): Promise<TruthView | null> {
  const r = await getRow(email);
  return r ? view(r) : null;
}

export interface SyncDeps { access(email: string): Promise<string | null>; location(email: string, access: string): Promise<string | null>; detail(access: string, location: string): Promise<Record<string, any>> }
const realSync: SyncDeps = {
  access: accessFor,
  /**
   * The connected location. Right after connecting none is saved yet: it is chosen the same way the
   * numbers screen chooses it (the Google location of a business the customer saved, or the only
   * one in the account) and saved. Several locations and no match: the customer has to choose.
   */
  async location(email, access) {
    const saved = (await getConnection(email))?.location_name ?? null;
    if (saved) return saved;
    const placeIds = (await listBusinesses(email)).map((b) => b.google_place_id).filter((x): x is string => !!x);
    const loc = pickLocation(await listLocations(access), null, placeIds);
    if (loc) await setLocation(email, loc.name);
    return loc?.name ?? null;
  },
  detail: (access, location) => fetchLocationDetail(access, location),
};

/**
 * Reads the customer's card from Google and merges it over what we hold. A card that was already
 * approved stays approved: the customer agreed to how we work, not to one snapshot of the data.
 * If the customer connected a different location, the old card is replaced, and approval is reset.
 */
export async function syncFromGoogle(email: string, now = new Date(), deps: SyncDeps = realSync): Promise<TruthView> {
  const access = await deps.access(email);
  if (!access) throw new TruthError('not_connected');
  let raw: Record<string, any>;
  let location: string | null = null;
  try {
    location = await deps.location(email, access);
    if (!location) throw new TruthError('no_location');
    raw = await deps.detail(access, location);
  } catch (e) {
    if (e instanceof TruthError) throw e;
    if (e instanceof GbpError && e.code === 'revoked') { await markNeedsReconnect(email, 'revoked').catch(() => undefined); throw new TruthError('not_connected'); }
    if (e instanceof GbpError && /http_429/.test(e.message)) throw new TruthError('quota_pending');
    console.error('[TRUTH] sync failed:', e instanceof Error ? e.message.slice(0, 160) : 'unknown');
    throw new TruthError('google');
  }
  const prev = await getRow(email);
  const same = prev?.location_name === location;
  const card = mergeFromGoogle(same ? { ...emptyCard(), ...prev!.card } : null, parseLocation(raw));
  const row: Row = { owner_email: email, location_name: location, card, fetched_at: now.toISOString(), approved_at: same ? prev!.approved_at : null };
  await putRow(row, now);
  if (!prev || !same) await logActivity(email, 'card_synced', 'קראנו את פרטי העסק מכרטיס העסק שלכם בגוגל', null, `sync:${location}`);
  return view(row);
}

/** The customer's edit. Throws CardInputError (from businessTruth.ts) on bad input. */
export async function saveEdit(email: string, input: unknown, now = new Date()): Promise<TruthView> {
  const prev = await getRow(email);
  if (!prev) throw new TruthError('not_found');
  const row: Row = { ...prev, card: applyEdit({ ...emptyCard(), ...prev.card }, input) };
  await putRow(row, now);
  return view(row);
}

/**
 * "הפרטים נכונים, תתחילו לעבוד": the one approval everything automatic waits for. It also records
 * the customer's consent to automatic publishing (they can change each engine later).
 */
export async function approve(email: string, now = new Date()): Promise<TruthView> {
  const prev = await getRow(email);
  if (!prev) throw new TruthError('not_found');
  const v = view(prev);
  if (!v.readiness.ready) throw new TruthError('not_ready');
  const row: Row = { ...prev, approved_at: prev.approved_at ?? now.toISOString() };
  await putRow(row, now);
  await setAutomation(email, { consent: true }, now);
  if (!prev.approved_at) await logActivity(email, 'card_approved', 'אישרתם את פרטי העסק, ואנחנו מתחילים לעבוד', null, 'approved');
  return view(row);
}

/** Off unless GBP_WRITEBACK_ENABLED=true: writing to a customer's Google listing is unverified against live Google. */
export const writeBackEnabled = (): boolean => process.env.GBP_WRITEBACK_ENABLED === 'true';

export interface WriteBackDeps extends SyncDeps { patch(access: string, location: string, body: Record<string, unknown>, mask: string[]): Promise<void>; card(email: string): Promise<{ card: TruthCard; approved: boolean; location: string | null } | null>; log: typeof logActivity }
const realWriteBack: WriteBackDeps = {
  ...realSync,
  patch: (access, location, body, mask) => patchLocation(access, location, body, mask),
  async card(email) { const r = await getRow(email); return r ? { card: { ...emptyCard(), ...r.card }, approved: !!r.approved_at, location: r.location_name } : null; },
  log: logActivity,
};

/**
 * After approval: adds to the customer's Google listing what they completed here and Google lacks
 * (see writeBackPlan). Never throws and never blocks the approval; returns what happened.
 * Only for an approved card, and only for the location the card was read from.
 */
export async function writeBackToGoogle(email: string, deps: WriteBackDeps = realWriteBack): Promise<'off' | 'nothing' | 'written' | 'failed'> {
  if (!writeBackEnabled()) return 'off';
  try {
    const mine = await deps.card(email);
    if (!mine?.approved || !mine.location) return 'nothing';
    const access = await deps.access(email);
    if (!access) return 'failed';
    const location = await deps.location(email, access);
    if (location !== mine.location) return 'nothing';
    const plan = writeBackPlan(await deps.detail(access, location), mine.card);   // a fresh read: the list we append to is the one Google holds now
    if (!plan) return 'nothing';
    await deps.patch(access, location, plan.body, plan.mask);
    await deps.log(email, 'card_synced', 'הוספנו לכרטיס העסק שלכם בגוגל את מה שהשלמתם', plan.summary.join(', '), `writeback:${new Date().toISOString().slice(0, 10)}`);
    return 'written';
  } catch (e) {
    console.error('[TRUTH] write-back failed:', e instanceof Error ? e.message.slice(0, 160) : 'unknown');
    return 'failed';
  }
}
