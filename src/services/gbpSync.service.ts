// Full sync with the customer's Google Business Profile: storage and Google calls
// (docs/gbp-sync-spec.md; migration 050). The pure rules are in gbpSync.ts.
//
// Every write to Google is behind GBP_WRITEBACK_ENABLED (businessTruth.service.ts): with the switch
// off, a saved field stays here and the customer is told so. A field reaches our card only after
// Google accepted it (validateOnly, then the real PATCH, then a fresh read).

import { supabase } from '../config/supabase';
import { CardInputError, type TruthCard, emptyCard, parseLocation } from './businessTruth';
import { writeBackEnabled } from './businessTruth.service';
import {
  type GbpPhoto, type PhotoCategory, GbpError, GbpQuota, GbpRejected, PHOTO_CATEGORIES,
  createMedia, deleteMedia, fetchLocationDetail, getGoogleUpdated, listLocations, listMedia, patchLocation,
} from './gbpGoogle';
import { getConnection, markNeedsReconnect } from './gbpStore';
import { accessFor } from './reviewAlerts.service';
import { type WebsiteMode, autopilotEnabled, getAutomation, logActivity, missingTable } from './automation.service';
import { businessPageId } from './seoPageAddon.service';
import { shareUrl } from './subdomain.service';
import { isEntitled } from './entitlements.service';
import { withHeartbeat } from './opsMetrics.service';
import {
  type FieldView, type GoogleState, type SyncField, FIELD_HE, SYNC_FIELDS,
  adoptChanges, applyField, buildPatch, fieldStatus, fieldValue, readState, takeGoogle,
} from './gbpSync';

export type SyncErrorCode = 'not_found' | 'not_connected' | 'invalid' | 'google_rejected' | 'quota' | 'google' | 'not_migrated' | 'no_page' | 'bad_photo' | 'nothing_to_resolve' | 'sync_off';
export class SyncError extends Error {
  constructor(public readonly code: SyncErrorCode, public readonly detail: string | null = null, public readonly field: string | null = null) { super(code); }
}

interface TruthRow { owner_email: string; location_name: string | null; card: TruthCard; approved_at: string | null; google_state: unknown }

export interface SyncDeps {
  writeEnabled(): boolean;
  row(email: string): Promise<TruthRow | null>;
  save(email: string, patch: { card?: TruthCard; google_state?: GoogleState }, now: Date): Promise<void>;
  access(email: string): Promise<string | null>;
  /** The location connected NOW (null when not connected or none chosen). */
  connected(email: string): Promise<string | null>;
  detail(access: string, location: string): Promise<Record<string, any>>;
  updated(access: string, location: string): Promise<{ diffMask: string[]; pendingMask: string[] }>;
  patch(access: string, location: string, body: Record<string, unknown>, mask: string[], validateOnly: boolean): Promise<void>;
  revoked(email: string): Promise<void>;
  log: typeof logActivity;
  /** Public address of the business's own page when it is published, else null. */
  pageUrl(email: string): Promise<{ pageId: string; url: string } | null>;
  websiteMode(email: string): Promise<WebsiteMode>;
}

const COLS = 'owner_email, location_name, card, approved_at, google_state';
const noStateCol = (e: { message?: string; code?: string }) => e.code === '42703' || /google_state/.test(e.message ?? '');

export const realDeps: SyncDeps = {
  writeEnabled: writeBackEnabled,
  async row(email) {
    const { data, error } = await supabase.from('business_truth').select(COLS).eq('owner_email', email).maybeSingle();
    if (error) {
      if (noStateCol(error) || missingTable(error.message, error.code)) throw new SyncError('not_migrated');
      throw new Error(error.message);
    }
    return (data as TruthRow | null) ?? null;
  },
  async save(email, patch, now) {
    const { error } = await supabase.from('business_truth').update({ ...patch, updated_at: now.toISOString() }).eq('owner_email', email);
    if (error) { if (noStateCol(error)) throw new SyncError('not_migrated'); throw new Error(error.message); }
  },
  access: accessFor,
  async connected(email) {
    const c = await getConnection(email);
    return c?.status === 'active' ? c.location_name ?? null : null;
  },
  detail: (a, l) => fetchLocationDetail(a, l),
  updated: (a, l) => getGoogleUpdated(a, l),
  patch: (a, l, body, mask, validateOnly) => patchLocation(a, l, body, mask, fetch, { validateOnly }),
  revoked: async (email) => { await markNeedsReconnect(email, 'revoked').catch(() => undefined); },
  log: logActivity,
  async pageUrl(email) {
    const id = await businessPageId(email);
    if (!id) return null;
    const { data } = await supabase.from('landing_pages').select('id, slug, subdomain, status').eq('id', id).maybeSingle();
    const p = data as { id: string; slug: string; subdomain: string | null; status: string } | null;
    return p && p.status === 'published' ? { pageId: p.id, url: shareUrl(p.slug, p.subdomain) } : null;
  },
  websiteMode: async (email) => (await getAutomation(email)).websiteMode,
};

const card = (r: TruthRow): TruthCard => ({ ...emptyCard(), ...(r.card ?? {}) });

/** Google errors in the words the API answers with. Revoked marks the connection for reconnecting. */
async function mapGoogle(e: unknown, email: string, deps: SyncDeps): Promise<never> {
  if (e instanceof SyncError || e instanceof CardInputError) throw e;
  if (e instanceof GbpRejected) throw new SyncError('google_rejected', e.googleMessage);
  if (e instanceof GbpQuota) throw new SyncError('quota');
  if (e instanceof GbpError && e.code === 'revoked') { await deps.revoked(email); throw new SyncError('not_connected'); }
  console.error('[GBP-SYNC] google call failed:', e instanceof Error ? e.message.slice(0, 160) : 'unknown');
  throw new SyncError('google');
}

/** Access token + the location the card describes, which must be the one connected now. */
async function target(email: string, row: TruthRow, deps: SyncDeps): Promise<{ access: string; location: string }> {
  const location = await deps.connected(email);
  if (!location || !row.location_name || location !== row.location_name) throw new SyncError('not_connected');
  const access = await deps.access(email).catch((e) => mapGoogle(e, email, deps));
  if (!access) throw new SyncError('not_connected');
  return { access, location };
}

/** A fresh read of what Google shows + which fields are pending or differ. `updated` failing is not fatal. */
async function readGoogle(access: string, location: string, deps: SyncDeps, prev: GoogleState, now: Date): Promise<{ raw: Record<string, any>; state: GoogleState }> {
  const raw = await deps.detail(access, location);
  let masks = { diffMask: [] as string[], pendingMask: [] as string[] };
  try { masks = await deps.updated(access, location); } catch (e) {
    if (e instanceof GbpError && e.code === 'revoked') throw e;
    // Some listings answer getGoogleUpdated with an error; the fields still show live / changed.
  }
  // hasPendingEdits without a pendingMask: every field we last wrote is still in review.
  const pending = masks.pendingMask.length || !raw?.metadata?.hasPendingEdits ? masks.pendingMask : prev.pendingMask;
  return { raw, state: { ...prev, google: parseLocation(raw), diffMask: masks.diffMask, pendingMask: pending, checkedAt: now.toISOString() } };
}

// ── GET /gbp/profile ─────────────────────────────────────────────────────────

export interface ProfileView {
  syncEnabled: boolean;
  location: string | null;
  fields: Record<SyncField, FieldView>;
  metadata: { mapsUri: string | null; newReviewUri: string | null };
  websiteSuggestion: { url: string; current: string | null } | null;
  checkedAt: string | null;
}

const REFRESH_AFTER_MS = 15 * 60 * 1000;

async function suggestion(email: string, ours: TruthCard, st: GoogleState, deps: SyncDeps): Promise<ProfileView['websiteSuggestion']> {
  const page = await deps.pageUrl(email);
  if (!page || (await deps.websiteMode(email)) === 'off') return null;
  const current = (st.google?.website || ours.website || '').trim();
  const same = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();
  return current && same(current, page.url) ? null : { url: page.url, current: current || null };
}

function viewOf(ours: TruthCard, st: GoogleState, syncEnabled: boolean, location: string | null): Omit<ProfileView, 'websiteSuggestion'> {
  const fields = Object.fromEntries(SYNC_FIELDS.map((f) => [f, fieldStatus(f, ours, st, syncEnabled)])) as Record<SyncField, FieldView>;
  const g = st.google;
  return {
    syncEnabled, location, fields,
    metadata: { mapsUri: (g?.mapsUrl || ours.mapsUrl) || null, newReviewUri: (g?.reviewUrl || ours.reviewUrl) || null },
    checkedAt: st.checkedAt,
  };
}

/**
 * The card as the profile screen shows it. Reads Google again when the last read is older than 15
 * minutes (best effort: a failed read shows the last known state).
 */
export async function getProfile(email: string, now = new Date(), deps: SyncDeps = realDeps): Promise<ProfileView> {
  const row = await deps.row(email);
  if (!row) throw new SyncError('not_found');
  let st = readState(row.google_state);
  const ours = card(row);
  const stale = !st.checkedAt || now.getTime() - Date.parse(st.checkedAt) > REFRESH_AFTER_MS;
  if (stale) {
    try {
      const t = await target(email, row, deps);
      st = (await readGoogle(t.access, t.location, deps, st, now)).state;
      await deps.save(email, { google_state: st }, now);
    } catch (e) {
      if (e instanceof SyncError && e.code === 'not_migrated') throw e;
      if (e instanceof GbpError && e.code === 'revoked') await deps.revoked(email);
      // Not connected, Google down: the screen still shows what we know.
    }
  }
  return { ...viewOf(ours, st, deps.writeEnabled(), row.location_name), websiteSuggestion: await suggestion(email, ours, st, deps) };
}

// ── PUT /gbp/profile/:field ──────────────────────────────────────────────────

export interface SaveResult { field: FieldView; syncEnabled: boolean; code?: 'sync_off' }

/**
 * Saves one field. With the sync switch on: validated by Google (validateOnly), written, read back,
 * and only then saved in our card. With the switch off: saved here only (`code: 'sync_off'`).
 */
export async function saveField(email: string, field: SyncField, value: unknown, now = new Date(), deps: SyncDeps = realDeps, title?: string): Promise<SaveResult> {
  const row = await deps.row(email);
  if (!row) throw new SyncError('not_found');
  const st = readState(row.google_state);
  let next: TruthCard;
  try { next = applyField(card(row), field, value); } catch (e) {
    if (e instanceof CardInputError) throw new SyncError('invalid', null, e.field);
    throw e;
  }

  if (!deps.writeEnabled()) {
    delete st.errors[field];
    await deps.save(email, { card: next, google_state: st }, now);
    return { field: fieldStatus(field, next, st, false), syncEnabled: false, code: 'sync_off' };
  }

  const t = await target(email, row, deps);
  try {
    const fresh = await readGoogle(t.access, t.location, deps, st, now);
    let p;
    try { p = buildPatch(field, next, fresh.raw); } catch (e) {
      if (e instanceof CardInputError) throw new SyncError('invalid', null, e.field);
      throw e;
    }
    if (!p) {
      // Nothing to send (an empty value never clears Google; services Google already lists).
      delete fresh.state.errors[field];
      await deps.save(email, { card: next, google_state: fresh.state }, now);
      return { field: fieldStatus(field, next, fresh.state, true), syncEnabled: true };
    }
    await deps.patch(t.access, t.location, p.body, p.mask, true);
    await deps.patch(t.access, t.location, p.body, p.mask, false);
    const after = await readGoogle(t.access, t.location, deps, fresh.state, now);
    delete after.state.errors[field];
    await deps.save(email, { card: next, google_state: after.state }, now);
    await deps.log(email, 'card_field_synced', title ?? `עדכנו בכרטיס שלכם בגוגל: ${FIELD_HE[field]}`, 'גוגל לפעמים בודקת שינוי עד כמה ימים לפני שהוא מופיע.', null);
    return { field: fieldStatus(field, next, after.state, true), syncEnabled: true };
  } catch (e) {
    if (e instanceof GbpRejected) {
      // Google refused the value: our card keeps the old one; the reason is remembered for the screen.
      st.errors[field] = e.googleMessage;
      await deps.save(email, { google_state: st }, now).catch(() => undefined);
    }
    return mapGoogle(e, email, deps);
  }
}

/** POST /gbp/profile/:field/resolve {keep}: for a field Google changed. */
export async function resolveField(email: string, field: SyncField, keep: 'google' | 'ours', now = new Date(), deps: SyncDeps = realDeps): Promise<SaveResult> {
  const row = await deps.row(email);
  if (!row) throw new SyncError('not_found');
  const st = readState(row.google_state);
  if (!st.google) throw new SyncError('nothing_to_resolve');
  const ours = card(row);
  if (keep === 'ours') return saveField(email, field, fieldValue(field, ours), now, deps);
  const next = takeGoogle(field, ours, st.google);
  delete st.errors[field];
  await deps.save(email, { card: next, google_state: st }, now);
  return { field: fieldStatus(field, next, st, deps.writeEnabled()), syncEnabled: deps.writeEnabled() };
}

/** POST /gbp/profile/website-from-page: the suggestion "show the landing page as your website in Google". */
export async function websiteFromPage(email: string, now = new Date(), deps: SyncDeps = realDeps): Promise<SaveResult> {
  const page = await deps.pageUrl(email);
  if (!page) throw new SyncError('no_page');
  return saveField(email, 'website', page.url, now, deps, 'הוספנו את הדף שלכם כאתר בכרטיס בגוגל');
}

// ── Website when the business's own page is published ────────────────────────

export type PublishOutcome = 'not_business_page' | 'off' | 'no_url' | 'no_card' | 'set' | 'local' | 'suggested' | 'already' | 'failed';

/**
 * Called after any page is published (publishPageById). For the business's own page:
 *   website_mode 'auto' + no website in Google -> the page becomes the listing's website;
 *   Google has another website, or mode 'ask' -> only a suggestion on the home screen (GET /gbp/profile);
 *   mode 'off' -> nothing. Never throws.
 */
export async function onPagePublished(email: string, pageId: string, now = new Date(), deps: SyncDeps = realDeps): Promise<PublishOutcome> {
  try {
    const page = await deps.pageUrl(email);
    if (!page || page.pageId !== pageId) return page ? 'not_business_page' : 'no_url';
    const mode = await deps.websiteMode(email);
    if (mode === 'off') return 'off';
    const row = await deps.row(email);
    if (!row) return 'no_card';
    const ours = card(row);
    if (!deps.writeEnabled()) {
      if (mode !== 'auto' || ours.website) return ours.website === page.url ? 'already' : 'suggested';
      await deps.save(email, { card: { ...ours, website: page.url } }, now);
      return 'local';
    }
    const t = await target(email, row, deps);
    const g = parseLocation(await deps.detail(t.access, t.location));
    if (g.website === page.url) return 'already';
    if (mode !== 'auto' || g.website) return 'suggested';
    await saveField(email, 'website', page.url, now, deps, 'הוספנו את הדף שלכם כאתר בכרטיס בגוגל');
    return 'set';
  } catch (e) {
    console.error('[GBP-SYNC] website on publish failed:', e instanceof Error ? e.message.slice(0, 160) : 'unknown');
    return 'failed';
  }
}

// ── Weekly re-read ───────────────────────────────────────────────────────────

export const PROFILE_REFRESH_DAYS = 7;
export interface ProfileSweepResult { accounts: number; refreshed: number; adopted: number; failed: number }
export interface ProfileSweepDeps extends SyncDeps { accounts(now: Date): Promise<string[]> }

/**
 * For every paying, connected account with an approved card: reads the listing again when the last
 * read is a week old, and takes into our card what changed in Google since then (adoptChanges).
 * One account failing never stops the others.
 */
export async function sweepProfiles(now = new Date(), deps: ProfileSweepDeps = realSweepDeps): Promise<ProfileSweepResult> {
  const out: ProfileSweepResult = { accounts: 0, refreshed: 0, adopted: 0, failed: 0 };
  for (const email of (await deps.accounts(now)).slice(0, 500)) {
    out.accounts++;
    try {
      const row = await deps.row(email);
      if (!row?.approved_at) continue;
      const st = readState(row.google_state);
      if (st.checkedAt && now.getTime() - Date.parse(st.checkedAt) < PROFILE_REFRESH_DAYS * 86_400_000) continue;
      const t = await target(email, row, deps);
      const fresh = await readGoogle(t.access, t.location, deps, st, now);
      const { card: next, adopted } = adoptChanges(card(row), st.google, fresh.state.google!);
      await deps.save(email, adopted.length ? { card: next, google_state: fresh.state } : { google_state: fresh.state }, now);
      out.refreshed++;
      if (adopted.length) {
        out.adopted++;
        await deps.log(email, 'card_synced', `עדכנו מגוגל: ${adopted.map((f) => FIELD_HE[f]).join(', ')}`, 'שיניתם את הפרטים בגוגל, ועכשיו גם הפוסטים שלנו כותבים לפיהם.', `adopt:${now.toISOString().slice(0, 10)}`);
      }
    } catch (e) {
      if (e instanceof GbpError && e.code === 'revoked') await deps.revoked(email);
      if (e instanceof SyncError && e.code === 'not_connected') continue;   // not connected is not a failure of the sweep
      out.failed++;
      console.error('[GBP-SYNC] weekly read failed for one account:', e instanceof Error ? e.message.slice(0, 160) : 'unknown');
    }
  }
  return out;
}

const realSweepDeps: ProfileSweepDeps = {
  ...realDeps,
  async accounts(now) {
    const { data: prod, error } = await supabase.from('user_products').select('email, status, current_period_end').eq('product', 'seo_autopilot');
    if (error) throw new Error(error.message);
    const paying = ((prod ?? []) as { email: string; status: string; current_period_end: string | null }[]).filter((r) => isEntitled(r, now)).map((r) => r.email);
    if (!paying.length) return [];
    const { data: conn } = await supabase.from('gbp_connections').select('email').eq('status', 'active').not('location_name', 'is', null).in('email', paying);
    return ((conn ?? []) as { email: string }[]).map((r) => r.email);
  },
};

/** Daily run; each account is read again when its last read is a week old. Same switch as the other automatic sweeps. */
export function startProfileSweep(): void {
  if (!autopilotEnabled()) return;
  const run = () => { withHeartbeat('gbp_profile', () => sweepProfiles()).catch((e) => console.error('[GBP-SYNC] sweep crashed:', e)); };
  setTimeout(run, 11 * 60 * 1000).unref?.();
  setInterval(run, 24 * 3_600_000).unref?.();
}

// ── Photos (spec, phase 2) ───────────────────────────────────────────────────

export interface PhotoDeps {
  writeEnabled(): boolean;
  row(email: string): Promise<TruthRow | null>;
  access(email: string): Promise<string | null>;
  connected(email: string): Promise<string | null>;
  revoked(email: string): Promise<void>;
  /** The v4 account that owns the location ("accounts/…"). */
  account(access: string, location: string): Promise<string | null>;
  list(access: string, account: string, location: string): Promise<GbpPhoto[]>;
  create(access: string, account: string, location: string, sourceUrl: string, category: PhotoCategory): Promise<string | null>;
  remove(access: string, account: string, location: string, id: string): Promise<void>;
  log: typeof logActivity;
}

export const realPhotoDeps: PhotoDeps = {
  writeEnabled: writeBackEnabled,
  row: realDeps.row, access: realDeps.access, connected: realDeps.connected, revoked: realDeps.revoked,
  async account(access, location) { return (await listLocations(access)).find((l) => l.name === location)?.account ?? null; },
  list: (a, acc, l) => listMedia(a, acc, l),
  create: (a, acc, l, url, cat) => createMedia(a, acc, l, url, cat),
  remove: (a, acc, l, id) => deleteMedia(a, acc, l, id),
  log: logActivity,
};

async function photoTarget(email: string, deps: PhotoDeps): Promise<{ access: string; account: string; location: string }> {
  const row = await deps.row(email);
  if (!row) throw new SyncError('not_found');
  const location = await deps.connected(email);
  if (!location || location !== row.location_name) throw new SyncError('not_connected');
  try {
    const access = await deps.access(email);
    if (!access) throw new SyncError('not_connected');
    const account = await deps.account(access, location);
    if (!account) throw new SyncError('not_connected');
    return { access, account, location };
  } catch (e) { return mapGoogle(e, email, deps as unknown as SyncDeps); }
}

export async function listPhotos(email: string, deps: PhotoDeps = realPhotoDeps): Promise<GbpPhoto[]> {
  const t = await photoTarget(email, deps);
  try { return await deps.list(t.access, t.account, t.location); } catch (e) { return mapGoogle(e, email, deps as unknown as SyncDeps); }
}

export const isPhotoCategory = (v: unknown): v is PhotoCategory => typeof v === 'string' && (PHOTO_CATEGORIES as readonly string[]).includes(v);

/**
 * Adds a photo to the listing. `store` produces the public https URL of the JPEG and is called only
 * after the listing is known to be reachable (no orphan files for a disconnected account). Photos are
 * sent only while the sync switch is on.
 */
export async function addPhoto(email: string, category: PhotoCategory, store: () => Promise<string>, deps: PhotoDeps = realPhotoDeps): Promise<{ id: string | null }> {
  if (!deps.writeEnabled()) throw new SyncError('sync_off');
  const t = await photoTarget(email, deps);
  const publicUrl = await store();
  try {
    const id = await deps.create(t.access, t.account, t.location, publicUrl, category);
    await deps.log(email, 'photo_added', 'הוספנו תמונה לכרטיס שלכם בגוגל', 'גוגל בודקת כל תמונה לפני שהיא מוצגת, בדרך כלל תוך כמה שעות.', id ? `photo:${id}` : null);
    return { id };
  } catch (e) { return mapGoogle(e, email, deps as unknown as SyncDeps); }
}

export async function removePhoto(email: string, id: string, deps: PhotoDeps = realPhotoDeps): Promise<void> {
  if (!deps.writeEnabled()) throw new SyncError('sync_off');
  if (!/^[\w-]{4,200}$/.test(id)) throw new SyncError('bad_photo');
  const t = await photoTarget(email, deps);
  try {
    await deps.remove(t.access, t.account, t.location, id);
    await deps.log(email, 'photo_removed', 'הסרנו תמונה מהכרטיס שלכם בגוגל', null, `photo-removed:${id}`);
  } catch (e) { return mapGoogle(e, email, deps as unknown as SyncDeps); }
}
