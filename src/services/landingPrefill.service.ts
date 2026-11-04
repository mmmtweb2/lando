// Prefill for the Pagey wizard from a connected Google business (task #16).
//
// Product rules (Avi / Moshe):
//  - The data is fetched ONCE, on the owner's request, shown to them for approval and never
//    stored here: no photos, no reviews, nothing persisted. Whatever the owner keeps becomes
//    their own page content when they save it (flagged for legal review in the README).
//  - The resulting page is a DRAFT built from approximate Google data; the UI says so before
//    and after creation.
// Pure helpers only (no I/O) so they are unit-testable.

import type { PlaceSnapshot } from './placesAudit';

export interface LandingPrefill {
  business_name: string;
  phone_number: string;
  address: string;
  business_hours: string;
  category: string;
  website: string;
}

/** Per-account daily cap on prefill (each one is a Places Details call). In-memory, like seo.controller. */
export const PREFILL_DAILY_LIMIT = 3;
const usage = new Map<string, { day: string; count: number }>();

export function underPrefillLimit(email: string, now = new Date()): boolean {
  const day = now.toISOString().slice(0, 10);
  const u = usage.get(email);
  if (!u || u.day !== day) { usage.set(email, { day, count: 1 }); return true; }
  if (u.count >= PREFILL_DAILY_LIMIT) return false;
  u.count += 1;
  return true;
}

/** Opening hours as readable lines ("יום ראשון: 09:00–18:00"), from Google's own localized strings. */
export function hoursText(hours: unknown): string {
  const lines = (hours as { weekdayDescriptions?: unknown } | null | undefined)?.weekdayDescriptions;
  if (!Array.isArray(lines)) return '';
  return lines.filter((l): l is string => typeof l === 'string').slice(0, 7).join('\n').slice(0, 500);
}

function cleanPhone(p: string | undefined): string {
  return (p ?? '').replace(/[^\d+]/g, '').slice(0, 20);
}

function cleanUrl(u: string | undefined): string {
  if (!u) return '';
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString().slice(0, 300) : '';
  } catch { return ''; }
}

export function mapPlaceToPrefill(place: PlaceSnapshot): LandingPrefill {
  return {
    business_name: (place.displayName?.text ?? '').trim().slice(0, 120),
    phone_number: cleanPhone(place.nationalPhoneNumber),
    address: (place.formattedAddress ?? '').trim().slice(0, 200),
    business_hours: hoursText(place.regularOpeningHours),
    category: (place.primaryTypeDisplayName?.text ?? '').trim().slice(0, 80),
    website: cleanUrl(place.websiteUri),
  };
}

export const DRAFT_NOTICE = 'זו טיוטה שנוצרה מנתונים משוערים מגוגל. עבור עליה ותקן לפני פרסום.';
