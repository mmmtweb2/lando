// "הכרטיס שלכם בגוגל" (docs/gbp-sync-spec.md): the shapes of /api/seo/gbp/profile and /api/seo/gbp/photos.
// The server sends each field as { ours, google, status, error? }. Values are normalized on arrival
// (profileApi.ts) so a slightly different server shape never breaks the screen.

import type { TruthHours } from './types';

export type FieldKey = 'website' | 'description' | 'phone' | 'hours' | 'specialHours' | 'services';
export const FIELD_KEYS: FieldKey[] = ['website', 'description', 'phone', 'hours', 'specialHours', 'services'];

/** One special day: a holiday or a date with different hours. Closed, or one range. */
export interface SpecialDay { date: string; closed: boolean; open: string; close: string }
export interface ServiceItem { name: string; description: string }

export interface FieldValues {
  website: string;
  description: string;
  /** the main number first, then up to two more */
  phone: string[];
  hours: TruthHours[];
  specialHours: SpecialDay[];
  services: ServiceItem[];
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
