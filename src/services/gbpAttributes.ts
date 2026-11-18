// Yes/no attributes of the Google listing (accessibility, parking, payments, amenities...;
// docs/gbp-sync-spec.md, phase A). Pure rules, no I/O: reading Google's two answers (what exists for
// the category, and what the listing has set), keeping only the boolean ones, and comparing.
//
// Only BOOL attributes are handled. Google also has enum, repeated-enum and URL attributes (menu and
// ordering links are URL attributes); they are skipped on purpose, in both directions.
// Sources: https://developers.google.com/my-business/reference/businessinformation/rest/v1/attributes
//          https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations/updateAttributes
// UNVERIFIED against live Google: covered by tests with fake responses.

import { CardInputError, type TruthCard } from './businessTruth';

/** "attributes/has_wheelchair_accessible_entrance": the key used everywhere (Google's own resource name). */
export const ATTR_NAME = /^attributes\/[A-Za-z0-9_.-]{2,100}$/;
export const MAX_ATTRIBUTES = 400;

/** One attribute Google offers for the listing's category: boolean only, with the words to show. */
export interface AttributeMeta { name: string; label: string; group: string }
export type AttributeValues = Record<string, boolean>;

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Google's list of attributes available for a category (`attributes.list`) -> the boolean ones that
 * can be shown: valueType BOOL, not repeatable, not deprecated, with a display name. The resource name
 * is in `parent` in Google's reply; `name` is accepted as well.
 */
export function parseAttributeMetadata(list: unknown): AttributeMeta[] {
  const out: AttributeMeta[] = [];
  const seen = new Set<string>();
  for (const m of Array.isArray(list) ? list : []) {
    const name = typeof m?.parent === 'string' ? m.parent : typeof m?.name === 'string' ? m.name : '';
    const label = clean(m?.displayName, 120);
    if (!ATTR_NAME.test(name) || seen.has(name) || m?.valueType !== 'BOOL' || m?.repeatable === true || m?.deprecated === true || !label) continue;
    seen.add(name);
    out.push({ name, label, group: clean(m?.groupDisplayName, 80) });
    if (out.length >= MAX_ATTRIBUTES) break;
  }
  return out;
}

/**
 * What the listing has set (`locations/{id}/attributes`): only boolean values. An attribute Google
 * did not set is simply absent. Anything that is not a single true/false is skipped.
 */
export function parseAttributes(resp: unknown): AttributeValues {
  const out: AttributeValues = {};
  const list = (resp as { attributes?: unknown } | null)?.attributes;
  for (const a of Array.isArray(list) ? list : []) {
    const name = typeof a?.name === 'string' ? a.name : '';
    if (!ATTR_NAME.test(name) || a?.valueType !== 'BOOL' || !Array.isArray(a?.values) || a.values.length !== 1 || typeof a.values[0] !== 'boolean') continue;
    out[name] = a.values[0];
  }
  return out;
}

/** Only the attributes of `meta` (what the screen can show and we may write). */
export function onlyKnown(values: AttributeValues | undefined, meta: readonly AttributeMeta[]): AttributeValues {
  const known = new Set(meta.map((m) => m.name));
  return Object.fromEntries(Object.entries(values ?? {}).filter(([k]) => known.has(k)));
}

/** True when both sides agree on every attribute either of them has set (the ones in `only`, when given). */
export function sameAttributes(ours: AttributeValues | undefined, google: AttributeValues | undefined, only?: ReadonlySet<string>): boolean {
  return differing(ours, google, only).length === 0;
}

/** The names on which ours and Google's differ. An attribute only one side has set counts as different. */
export function differing(ours: AttributeValues | undefined, google: AttributeValues | undefined, only?: ReadonlySet<string>): string[] {
  const o = ours ?? {}, g = google ?? {};
  return [...new Set([...Object.keys(o), ...Object.keys(g)])].filter((k) => (!only || only.has(k)) && o[k] !== g[k]).sort();
}

/**
 * The customer's new yes/no values over the card. Names must be attributes Google offers for this
 * listing (`allowed`) and every value true or false. Attributes the customer does not mention keep
 * their value: nothing is ever unset in Google.
 */
export function applyAttributes(card: TruthCard, value: unknown, allowed: ReadonlySet<string>): TruthCard {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CardInputError('attributes');
  const incoming = Object.entries(value as Record<string, unknown>);
  if (incoming.length > MAX_ATTRIBUTES) throw new CardInputError('attributes');
  const next: AttributeValues = { ...(card.attributes ?? {}) };
  for (const [k, v] of incoming) {
    if (!allowed.has(k) || typeof v !== 'boolean') throw new CardInputError('attributes');
    next[k] = v;
  }
  return { ...card, attributes: next };
}

export interface AttributesPatch { names: string[]; body: { name?: string; attributes: { name: string; valueType: 'BOOL'; values: [boolean] }[] } }

/**
 * The PATCH for the attributes: only those we have set that differ from Google, each as one boolean.
 * Null when there is nothing to send. Never a delete: an attribute missing on our side is not in the
 * mask. Only names in `allowed` (boolean attributes of the category) can be sent.
 */
export function buildAttributesPatch(ours: AttributeValues | undefined, google: AttributeValues | undefined, allowed: ReadonlySet<string>): AttributesPatch | null {
  const o = ours ?? {};
  const names = Object.keys(o).filter((k) => allowed.has(k) && typeof o[k] === 'boolean' && google?.[k] !== o[k]).sort();
  if (!names.length) return null;
  return { names, body: { attributes: names.map((name) => ({ name, valueType: 'BOOL' as const, values: [o[name]] as [boolean] })) } };
}

/** Ours with Google's value taken on every attribute that differs. Google's "not set" removes ours from the card (it is not sent back). */
export function takeGoogleAttributes(ours: AttributeValues | undefined, google: AttributeValues | undefined, only?: ReadonlySet<string>): AttributeValues {
  const next: AttributeValues = { ...(ours ?? {}) };
  for (const k of differing(ours, google, only)) {
    if (google && typeof google[k] === 'boolean') next[k] = google[k]; else delete next[k];
  }
  return next;
}

/**
 * The weekly re-read: an attribute that changed in Google since the last read, and that we had not
 * changed ourselves in between, is taken from Google. Both reads must have succeeded.
 */
export function adoptAttributes(ours: AttributeValues | undefined, prev: AttributeValues | undefined, next: AttributeValues | undefined): { values: AttributeValues; changed: boolean } {
  if (!prev || !next) return { values: ours ?? {}, changed: false };
  const values: AttributeValues = { ...(ours ?? {}) };
  let changed = false;
  for (const k of differing(prev, next)) {
    if (values[k] !== prev[k]) continue;                      // we changed it ourselves: keep ours
    if (typeof next[k] !== 'boolean') continue;               // not set in Google any more: not copied as "nothing"
    values[k] = next[k];
    changed = true;
  }
  return { values, changed };
}
