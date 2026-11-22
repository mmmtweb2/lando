// "הכרטיס שלכם בגוגל" (docs/gbp-sync-spec.md): the shapes of /api/seo/gbp/profile and /api/seo/gbp/photos.
// The server sends each field as { ours, google, status, error? }. Values are normalized on arrival
// (profileApi.ts) so a slightly different server shape never breaks the screen.

import type { TruthHours } from './types';

export type FieldKey = 'website' | 'description' | 'phone' | 'hours' | 'specialHours' | 'services' | 'serviceArea' | 'attributes';
export const FIELD_KEYS: FieldKey[] = ['website', 'description', 'phone', 'hours', 'specialHours', 'services', 'serviceArea', 'attributes'];

/** One special day: a holiday or a date with different hours. Closed, or one range. */
export interface SpecialDay { date: string; closed: boolean; open: string; close: string }
export interface ServiceItem { name: string; description: string }
/**
 * The regions the business serves (phase A). `type` is how Google holds the listing: with the street
 * address shown too, or serving customers only at their place (address hidden). It is shown, never edited here.
 */
export type ServiceAreaType = 'CUSTOMER_AND_BUSINESS_LOCATION' | 'CUSTOMER_LOCATION_ONLY';
export interface AreaValue { type: ServiceAreaType | null; places: string[] }
/** Yes/no attributes keyed by Google's name ("attributes/has_delivery"); a name that is absent was never set. */
export type AttributeValues = Record<string, boolean>;
/** One yes/no attribute Google offers for the listing, with the words to show (from the server). */
export interface AttributeItem { name: string; label: string; group: string }
/** An upcoming Israeli holiday the owner can add as a closed day (suggestion only). */
export interface HolidaySuggestion { id: string; name: string; date: string }

export interface FieldValues {
  website: string;
  description: string;
  /** the main number first, then up to two more */
  phone: string[];
  hours: TruthHours[];
  specialHours: SpecialDay[];
  services: ServiceItem[];
  serviceArea: AreaValue;
  attributes: AttributeValues;
}

/**
 * live: what we hold is what Google shows · pending: sent, Google is still checking ·
 * google_changed: Google (or the owner, on Google) changed it · local_only: kept here only
 * (sync is off, or sending failed: `error` says why)
 */
export type FieldStatus = 'live' | 'pending' | 'google_changed' | 'local_only';

export interface ProfileField<K extends FieldKey = FieldKey> {
  ours: FieldValues[K] | null;
  google: FieldValues[K] | null;
  status: FieldStatus;
  error: string | null;
}
export type ProfileFields = { [K in FieldKey]?: ProfileField<K> };

export interface GbpProfile {
  /** false: GBP_WRITEBACK_ENABLED is off, saves stay with us */
  syncEnabled: boolean;
  location: string | null;
  fields: ProfileFields;
  metadata: { mapsUri: string | null; newReviewUri: string | null };
  /** our published page could be the website on Google; `current` is what Google shows now (null = none) */
  websiteSuggestion: { url: string; current: string | null } | null;
  /** the yes/no attributes Google offers for this listing; empty until Google was read */
  attributeItems: AttributeItem[];
  /** the next Israeli holidays (about four months ahead), as "add as closed" suggestions */
  holidays: HolidaySuggestion[];
  checkedAt: string | null;
}

/** The result of saving one field: the field as it is now, and a sentence when it stayed with us. */
export type SaveResult =
  | { ok: true; field: ProfileField; localOnly: boolean; message: string | null }
  /** `detail`: Google's own words (often English), shown on a line of its own */
  | { ok: false; code: 'invalid' | 'google_rejected' | 'quota' | 'error'; message: string; detail?: string };

export type PhotoCategory = 'COVER' | 'PROFILE' | 'EXTERIOR' | 'INTERIOR' | 'PRODUCT' | 'AT_WORK' | 'TEAMS' | 'ADDITIONAL';
export const PHOTO_CATEGORIES: PhotoCategory[] = ['COVER', 'PROFILE', 'EXTERIOR', 'INTERIOR', 'PRODUCT', 'AT_WORK', 'TEAMS', 'ADDITIONAL'];

/** live: on the listing · processing: Google is still processing it (Google gives no "not approved" signal) */
export type PhotoState = 'live' | 'processing';
export interface GbpPhoto { id: string; url: string; thumbUrl: string; category: PhotoCategory | (string & {}); createdAt: string | null; state: PhotoState }

// ── "שיפור הניסוח" (README part 144): one suggestion for the description or the services ─────────

export type PolishField = 'description' | 'services';
/** error: Google would refuse it (or it is not grounded) · warn: a quality hint */
export interface PolishIssue { code: string; level: 'error' | 'warn'; text: string; index?: number }
/** A row of the suggested list: the owner's rows it stands for (2+ = merged), and whether its name is kept as on Google. */
export interface PolishedService extends ServiceItem { from: number[]; locked: boolean }
export type PolishResult =
  | { ok: true; field: 'description'; before: string; suggestion: string; issues: PolishIssue[]; unchanged: boolean; remaining: number }
  | { ok: true; field: 'services'; before: ServiceItem[]; suggestion: PolishedService[]; forgotten: string[]; issues: PolishIssue[]; unchanged: boolean; remaining: number }
  | { ok: false; code: 'limit' | 'unavailable' | 'failed' | 'error'; message: string };
/** What the owner has now (their unsaved draft counts), and the earlier suggestions of this dialog. */
export interface PolishRequest<F extends PolishField = PolishField> { draft: FieldValues[F]; previous: FieldValues[F][] }
