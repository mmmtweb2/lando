// Full sync with the customer's Google Business Profile (docs/gbp-sync-spec.md). Pure rules, no I/O:
// which fields we sync, how each one is validated, the exact body Google gets, how a field's status
// is worked out, and what a weekly re-read adopts. The I/O lives in gbpSync.service.ts.

import {
  type Day, type TruthCard, type TruthHours, type TruthSpecialHours, DAYS, CardInputError, applyEdit, emptyCard, parseLocation,
} from './businessTruth';
import { BARE_DOMAIN } from './gbpPosts';
import type { WritableMask } from './gbpGoogle';
import {
  type AttributeMeta, type AttributeValues, adoptAttributes, sameAttributes,
} from './gbpAttributes';
import { type AreaValue, applyServiceArea, areaValue, sameAreas, serviceAreaPatch } from './gbpServiceArea';

/** Fields that go to Google through locations.patch (phase 1 + the service area of phase A). */
export const SYNC_FIELDS = ['website', 'description', 'phone', 'hours', 'specialHours', 'services', 'serviceArea'] as const;
export type SyncField = (typeof SYNC_FIELDS)[number];
export const isSyncField = (v: unknown): v is SyncField => typeof v === 'string' && (SYNC_FIELDS as readonly string[]).includes(v);

/** The yes/no attributes (phase A) are a field of the screen too, but go to Google through their own call (gbpAttributes.ts). */
export const ATTRIBUTES = 'attributes' as const;
export type ProfileField = SyncField | typeof ATTRIBUTES;
export const isProfileField = (v: unknown): v is ProfileField => v === ATTRIBUTES || isSyncField(v);

export const MASK_OF: Record<SyncField, WritableMask> = {
  website: 'websiteUri', description: 'profile.description', phone: 'phoneNumbers',
  hours: 'regularHours', specialHours: 'specialHours', services: 'serviceItems', serviceArea: 'serviceArea',
};

export const FIELD_HE: Record<ProfileField, string> = {
  website: 'האתר', description: 'תיאור העסק', phone: 'מספרי הטלפון', hours: 'שעות הפעילות', specialHours: 'שעות בחגים ובימים מיוחדים', services: 'השירותים',
  serviceArea: 'אזורי השירות', attributes: 'המאפיינים',
};

export type FieldStatus = 'live' | 'pending' | 'google_changed' | 'local_only';

/** What Google showed at the last read (business_truth.google_state, migration 050). */
export interface GoogleState {
  google: TruthCard | null;
  pendingMask: string[];
  diffMask: string[];
  checkedAt: string | null;
  /** The last failure per field, in words the customer can act on. Cleared by the next success. */
  errors: Partial<Record<ProfileField, string>>;
  /** The boolean attributes Google offers for the listing's category, kept for a week (phase A). */
  attributeMeta: { category: string; fetchedAt: string; items: AttributeMeta[] } | null;
}
export const emptyState = (): GoogleState => ({ google: null, pendingMask: [], diffMask: [], checkedAt: null, errors: {}, attributeMeta: null });
export function readState(v: unknown): GoogleState {
  const s = (v && typeof v === 'object' ? v : {}) as Partial<GoogleState>;
  return {
    google: s.google ? { ...emptyCard(), ...s.google } : null,
    pendingMask: Array.isArray(s.pendingMask) ? s.pendingMask.filter((x) => typeof x === 'string') : [],
    diffMask: Array.isArray(s.diffMask) ? s.diffMask.filter((x) => typeof x === 'string') : [],
    checkedAt: typeof s.checkedAt === 'string' ? s.checkedAt : null,
    errors: s.errors && typeof s.errors === 'object' ? { ...s.errors } : {},
    attributeMeta: s.attributeMeta && typeof s.attributeMeta === 'object' && Array.isArray(s.attributeMeta.items) && typeof s.attributeMeta.category === 'string'
      ? { category: s.attributeMeta.category, fetchedAt: typeof s.attributeMeta.fetchedAt === 'string' ? s.attributeMeta.fetchedAt : '', items: s.attributeMeta.items } : null,
  };
}

// ── Values ───────────────────────────────────────────────────────────────────

export interface PhoneValue { primary: string; additional: string[] }
export interface ServiceValue { name: string; description: string }
export type FieldValue = string | PhoneValue | TruthHours[] | TruthSpecialHours[] | ServiceValue[] | AreaValue | AttributeValues;

/** The value of one field as the API shows it (`ours` / `google` in GET /gbp/profile). */
export function fieldValue(field: SyncField, c: TruthCard): FieldValue {
  switch (field) {
    case 'website': return c.website;
    case 'description': return c.description;
    case 'phone': return { primary: c.phone, additional: c.extraPhones ?? [] };
    case 'hours': return c.hours;
    case 'specialHours': return c.specialHours ?? [];
    case 'services': return c.services.map((s) => ({ name: s.name, description: s.description }));
    case 'serviceArea': return areaValue(c.serviceArea);
  }
}

const LINK_IN_TEXT = /https?:|www\.|\S+@\S+\.\S+/i;
const PHONE_IN_TEXT = /\+?\d[\d\s()-]{7,}\d/;

/**
 * The customer's new value for one field, applied over the card. Throws CardInputError(field) on bad
 * input. The website must be https; the description carries no links and no phone numbers (Google
 * rejects them, and they are the same checks our posts pass).
 */
export function applyField(card: TruthCard, field: SyncField, value: unknown): TruthCard {
  switch (field) {
    case 'website': {
      const w = typeof value === 'string' ? value.trim() : '';
      if (!/^https:\/\//i.test(w)) throw new CardInputError('website');
      return applyEdit(card, { website: w });
    }
    case 'description': {
      if (typeof value !== 'string' || !value.trim()) throw new CardInputError('description');
      if (LINK_IN_TEXT.test(value) || BARE_DOMAIN.test(value) || PHONE_IN_TEXT.test(value)) throw new CardInputError('descriptionContent');
      return applyEdit(card, { description: value });
    }
    case 'phone': {
      const v = (value ?? {}) as Partial<PhoneValue>;
      if (typeof v.primary !== 'string' || !v.primary.trim()) throw new CardInputError('phone');
      return applyEdit(card, { phone: v.primary, extraPhones: Array.isArray(v.additional) ? v.additional : [] });
    }
    case 'hours': return applyEdit(card, { hours: value });
    case 'specialHours': return applyEdit(card, { specialHours: value });
    case 'services': return applyEdit(card, { services: value });
    case 'serviceArea': return applyServiceArea(card, value);
  }
}

// ── The body Google gets ─────────────────────────────────────────────────────

const time = (t: string) => { const [h, m] = t.split(':').map(Number); return { hours: h, minutes: m }; };
const dateObj = (d: string) => { const [y, m, day] = d.split('-').map(Number); return { year: y, month: m, day }; };
const nextDay = (d: Day): Day => DAYS[(DAYS.indexOf(d) + 1) % 7];
const plusOneDay = (d: string): string => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
/** Closing at or before the opening time means after midnight ("20:00-02:00"); "24:00" is the end of the same day. */
const overnight = (open: string, close: string) => close !== '24:00' && close <= open;

export function regularHoursBody(hours: TruthHours[]) {
  return { periods: hours.map((h) => ({ openDay: h.day, openTime: time(h.open), closeDay: overnight(h.open, h.close) ? nextDay(h.day) : h.day, closeTime: time(h.close) })) };
}

export function specialHoursBody(days: TruthSpecialHours[]) {
  return {
    specialHourPeriods: days.map((d) => (d.closed
      ? { startDate: dateObj(d.date), endDate: dateObj(d.date), closed: true }
      : { startDate: dateObj(d.date), openTime: time(d.open), endDate: dateObj(overnight(d.open, d.close) ? plusOneDay(d.date) : d.date), closeTime: time(d.close) })),
  };
}

export interface FieldPatch { mask: WritableMask[]; body: Record<string, unknown> }

/**
 * The PATCH for one field, or null when there is nothing to send. Never clears anything in Google:
 * an empty local value sends nothing. `raw` is a FRESH read of the location: the services list is
 * replaced as a whole by Google, so what Google holds is sent back exactly as read, with ours after it.
 */
export function buildPatch(field: SyncField, c: TruthCard, raw: any): FieldPatch | null {
  switch (field) {
    case 'website': return c.website ? { mask: ['websiteUri'], body: { websiteUri: c.website } } : null;
    case 'description': return c.description ? { mask: ['profile.description'], body: { profile: { description: c.description } } } : null;
    case 'phone': return c.phone ? { mask: ['phoneNumbers'], body: { phoneNumbers: { primaryPhone: c.phone, additionalPhones: c.extraPhones ?? [] } } } : null;
    case 'hours': return c.hours.length ? { mask: ['regularHours'], body: { regularHours: regularHoursBody(c.hours) } } : null;
    case 'specialHours': {
      const days = c.specialHours ?? [];
      if (!days.length) return null;
      // Google accepts special hours only on a listing that has regular hours.
      if (!c.hours.length && !(Array.isArray(raw?.regularHours?.periods) && raw.regularHours.periods.length)) throw new CardInputError('specialHoursNeedHours');
      return { mask: ['specialHours'], body: { specialHours: specialHoursBody(days) } };
    }
    case 'services': {
      const category = typeof raw?.categories?.primaryCategory?.name === 'string' ? raw.categories.primaryCategory.name : '';
      const existing = Array.isArray(raw?.serviceItems) ? raw.serviceItems : [];
      const have = new Set(parseLocation(raw).services.map((s) => s.name.toLowerCase()));
      const added = c.services.filter((s) => !have.has(s.name.toLowerCase()));
      if (!category || !added.length) return null;
      if (existing.length + added.length > 100) throw new CardInputError('services');
      return {
        mask: ['serviceItems'],
        body: { serviceItems: [...existing, ...added.map((s) => ({ freeFormServiceItem: { category, label: { displayName: s.name, ...(s.description ? { description: s.description } : {}), languageCode: 'he' } } }))] },
      };
    }
    case 'serviceArea': return serviceAreaPatch(c, raw);
  }
}

// ── Comparing and status ─────────────────────────────────────────────────────

const site = (u: string) => u.trim().replace(/\/+$/, '').replace(/^https?:\/\//i, (m) => m.toLowerCase()).replace(/^(https?:\/\/)([^/]+)/i, (_m, a, h) => a + h.toLowerCase());
const digits = (p: string) => p.replace(/\D/g, '').replace(/^972/, '0');

/** True when our value of `field` is what Google shows. Services: everything we list is in Google (we never remove items there). */
export function sameField(field: SyncField, ours: TruthCard, google: TruthCard): boolean {
  switch (field) {
    case 'website': return site(ours.website) === site(google.website);
    case 'description': return ours.description.replace(/\s+/g, ' ').trim() === google.description.replace(/\s+/g, ' ').trim();
    case 'phone': {
      const a = [digits(ours.phone), ...(ours.extraPhones ?? []).map(digits).sort()].join('|');
      const b = [digits(google.phone), ...(google.extraPhones ?? []).map(digits).sort()].join('|');
      return a === b;
    }
    case 'hours': {
      const k = (h: TruthHours[]) => h.map((x) => `${x.day}${x.open}${x.close}`).sort().join('|');
      return k(ours.hours) === k(google.hours);
    }
    case 'specialHours': {
      const k = (h: TruthSpecialHours[]) => (h ?? []).map((x) => `${x.date}${x.closed ? 'c' : x.open + x.close}`).sort().join('|');
      return k(ours.specialHours) === k(google.specialHours);
    }
    case 'services': {
      const g = new Set(google.services.map((s) => s.name.toLowerCase()));
      return ours.services.every((s) => g.has(s.name.toLowerCase()));
    }
    case 'serviceArea': return sameAreas(ours.serviceArea?.places ?? [], google.serviceArea?.places ?? []);
  }
}

export interface FieldView { ours: FieldValue; google: FieldValue | null; status: FieldStatus; error?: string }

export function fieldStatus(field: SyncField, ours: TruthCard, st: GoogleState, syncEnabled: boolean): FieldView {
  const google = st.google ? fieldValue(field, st.google) : null;
  const view = (status: FieldStatus, error?: string): FieldView => ({ ours: fieldValue(field, ours), google, status, ...(error ? { error } : {}) });
  if (st.errors[field]) return view('local_only', st.errors[field]);
  if (!st.google) return view('local_only');
  const mask = MASK_OF[field];
  if (st.pendingMask.includes(mask)) return view('pending');
  if (sameField(field, ours, st.google)) return view('live');
  if (!syncEnabled) return view('local_only');
  return view('google_changed');
}

/**
 * The yes/no attributes as one field: ours and Google's values (only the attributes the screen offers),
 * and where they stand. Google gives no "being reviewed" signal for attributes, so there is no `pending`.
 */
export function attributesView(ours: TruthCard, st: GoogleState, syncEnabled: boolean): FieldView | null {
  const items = st.attributeMeta?.items ?? [];
  if (!items.length) return null;
  const only = new Set(items.map((i) => i.name));
  const pick = (v: AttributeValues | undefined) => Object.fromEntries(Object.entries(v ?? {}).filter(([k]) => only.has(k)));
  const google = st.google?.attributes !== undefined ? pick(st.google.attributes) : null;
  const view = (status: FieldStatus, error?: string): FieldView => ({ ours: pick(ours.attributes), google, status, ...(error ? { error } : {}) });
  if (st.errors.attributes) return view('local_only', st.errors.attributes);
  if (google === null) return view('local_only');
  if (sameAttributes(pick(ours.attributes), google)) return view('live');
  return syncEnabled ? view('google_changed') : view('local_only');
}

/** Our card with one field taken from what Google shows ("להשאיר את מה שבגוגל"). */
export function takeGoogle(field: SyncField, ours: TruthCard, google: TruthCard): TruthCard {
  switch (field) {
    case 'website': return { ...ours, website: google.website };
    case 'description': return { ...ours, description: google.description };
    case 'phone': return { ...ours, phone: google.phone, extraPhones: google.extraPhones ?? [] };
    case 'hours': return { ...ours, hours: google.hours };
    case 'specialHours': return { ...ours, specialHours: google.specialHours ?? [] };
    case 'services': {
      // Adds what Google has and we do not; never drops a service the customer listed here.
      const have = new Set(ours.services.map((s) => s.name.toLowerCase()));
      return { ...ours, services: [...ours.services, ...google.services.filter((s) => !have.has(s.name.toLowerCase()))].slice(0, 20) };
    }
    case 'serviceArea': return { ...ours, serviceArea: google.serviceArea ?? { type: null, places: [] } };
  }
}

/**
 * The weekly re-read. A field that changed in Google since our last read, and that we had not
 * changed ourselves in between (our value still equals the previous Google value), is taken from
 * Google: the owner (or Google) edited it there, and posts must not state old hours.
 * Nothing is adopted on the first read (no previous snapshot to compare with).
 */
export function adoptChanges(card: TruthCard, prevGoogle: TruthCard | null, nextGoogle: TruthCard): { card: TruthCard; adopted: ProfileField[] } {
  if (!prevGoogle) return { card, adopted: [] };
  let out = card;
  const adopted: ProfileField[] = [];
  for (const f of SYNC_FIELDS) {
    if (sameField(f, prevGoogle, nextGoogle) && sameField(f, nextGoogle, prevGoogle)) continue;   // Google did not change it
    if (!sameField(f, card, prevGoogle)) continue;                                                   // we changed it ourselves: keep ours
    if (f !== 'services' && !fieldPresent(f, nextGoogle)) continue;                                  // a value that disappeared in Google is not copied as an empty one
    out = takeGoogle(f, out, nextGoogle);
    if (!sameField(f, card, out) || !sameField(f, out, card)) adopted.push(f);
  }
  // The yes/no attributes: only when both reads carried them.
  const a = adoptAttributes(out.attributes, prevGoogle.attributes, nextGoogle.attributes);
  if (a.changed) { out = { ...out, attributes: a.values }; adopted.push(ATTRIBUTES); }
  return { card: out, adopted };
}

/**
 * A card saved before phase A has no service area and no attributes. The first time Google's values
 * are read they are taken as ours (nothing is written to Google), so the screen does not open with a
 * "Google changed it" conflict on fields the owner never touched.
 */
export function seedNewFields(card: TruthCard, google: TruthCard | null): { card: TruthCard; changed: boolean } {
  if (!google) return { card, changed: false };
  let out = card, changed = false;
  if (out.serviceArea === undefined) { out = { ...out, serviceArea: google.serviceArea ?? { type: null, places: [] } }; changed = true; }
  if (out.attributes === undefined && google.attributes !== undefined) { out = { ...out, attributes: { ...google.attributes } }; changed = true; }
  return { card: out, changed };
}

function fieldPresent(f: SyncField, c: TruthCard): boolean {
  switch (f) {
    case 'website': return !!c.website;
    case 'description': return !!c.description;
    case 'phone': return !!c.phone;
    case 'hours': return c.hours.length > 0;
    case 'specialHours': return (c.specialHours ?? []).length > 0;
    case 'services': return c.services.length > 0;
    case 'serviceArea': return (c.serviceArea?.places ?? []).length > 0;
  }
}
