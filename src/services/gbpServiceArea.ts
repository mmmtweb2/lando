// Service areas of the Google listing (docs/gbp-sync-spec.md, phase A): the pure rules around the
// list of regions a business serves, and finding Google's Place ID for a city or region the owner
// types. Google accepts a service area only as Place IDs of regions (locations.patch, updateMask
// `serviceArea`); the business's own address is never part of it.
// Sources: https://developers.google.com/my-business/reference/businessinformation/rest/v1/locations#ServiceAreaBusiness
//          https://developers.google.com/maps/documentation/places/web-service/text-search
// UNVERIFIED against live Google: covered by tests with fake responses.

import {
  CardInputError, MAX_SERVICE_AREA_PLACES, SERVICE_AREA_TYPES, type ServiceAreaType, type TruthAreaPlace, type TruthCard, type TruthServiceArea, line,
} from './businessTruth';

const NO_LINKS = /https?:|www\.|@/i;

/** For comparing names typed by hand with names Google returns: no spaces, quotes or case. */
export const areaKey = (s: string): string => s.toLowerCase().replace(/[\s"'`׳״,.-]+/g, '');

/** Two regions are the same when their Place IDs match, or (an id missing on one side) their names. */
export const sameAreaPlace = (a: TruthAreaPlace, b: TruthAreaPlace): boolean => (a.placeId && b.placeId ? a.placeId === b.placeId : areaKey(a.name) === areaKey(b.name));

/** The two lists name the same regions, in any order. */
export function sameAreas(a: readonly TruthAreaPlace[], b: readonly TruthAreaPlace[]): boolean {
  return a.length === b.length && a.every((p) => b.some((q) => sameAreaPlace(p, q))) && b.every((q) => a.some((p) => sameAreaPlace(p, q)));
}

/**
 * The owner's list of region names over the card. Names Google already has for this listing (or that
 * the card already holds) keep their Place ID; a new name has none yet ('') until it is resolved
 * (resolveMissing). At least one and at most 20 regions: an empty list never clears Google.
 * Throws CardInputError('serviceArea').
 */
export function applyServiceArea(card: TruthCard, value: unknown): TruthCard {
  const names = (value && typeof value === 'object' && !Array.isArray(value) ? (value as { places?: unknown }).places : value);
  if (!Array.isArray(names) || names.length < 1 || names.length > MAX_SERVICE_AREA_PLACES) throw new CardInputError('serviceArea');
  const known = new Map<string, TruthAreaPlace>((card.serviceArea?.places ?? []).map((p) => [areaKey(p.name), p]));
  const seen = new Set<string>();
  const places: TruthAreaPlace[] = [];
  for (const n of names) {
    const name = line(typeof n === 'string' ? n : (n as { name?: unknown } | null)?.name, 60);
    if (name.length < 2 || NO_LINKS.test(name) || /\d{3,}/.test(name)) throw new CardInputError('serviceArea');
    const k = areaKey(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    places.push({ name, placeId: known.get(k)?.placeId ?? '' });
  }
  return { ...card, serviceArea: { type: card.serviceArea?.type ?? null, places } };
}

/**
 * Fills in the Place ID of every region that has none: first from what Google already lists for the
 * listing, then through `resolve` (a lookup by name). Throws CardInputError('serviceAreaPlace') naming the
 * first region that could not be identified. Called only when the change is about to be sent.
 */
export async function resolveMissing(
  card: TruthCard, google: TruthCard | null, resolve: (name: string) => Promise<TruthAreaPlace | null>,
): Promise<TruthCard> {
  const sa = card.serviceArea;
  if (!sa) return card;
  const fromGoogle = new Map((google?.serviceArea?.places ?? []).filter((p) => p.placeId).map((p) => [areaKey(p.name), p]));
  const places: TruthAreaPlace[] = [];
  for (const p of sa.places) {
    if (p.placeId) { places.push(p); continue; }
    const have = fromGoogle.get(areaKey(p.name));
    const found = have ?? (await resolve(p.name));
    if (!found?.placeId) throw new CardInputError(`serviceAreaPlace:${p.name}`);
    places.push({ name: p.name, placeId: found.placeId });
  }
  const seen = new Set<string>();
  return { ...card, serviceArea: { ...sa, places: places.filter((p) => (seen.has(p.placeId) ? false : (seen.add(p.placeId), true))) } };
}

/**
 * The body of the PATCH: the regions, with the listing's kind kept exactly as Google holds it. The
 * kind decides whether the street address is shown, so it is never changed here; a listing without one
 * gets the kind that matches whether it has a street address. Null when there is nothing to send.
 */
export function serviceAreaPatch(c: TruthCard, raw: any): { mask: ['serviceArea']; body: Record<string, unknown> } | null {
  const places = c.serviceArea?.places ?? [];
  if (!places.length) return null;
  if (places.length > MAX_SERVICE_AREA_PLACES || places.some((p) => !p.placeId)) throw new CardInputError('serviceAreaPlace');
  const cur = raw?.serviceArea ?? {};
  const type: ServiceAreaType = SERVICE_AREA_TYPES.includes(cur.businessType) ? cur.businessType : (raw?.storefrontAddress ? 'CUSTOMER_AND_BUSINESS_LOCATION' : 'CUSTOMER_LOCATION_ONLY');
  return {
    mask: ['serviceArea'],
    body: {
      serviceArea: {
        businessType: type,
        ...(typeof cur.regionCode === 'string' && cur.regionCode ? { regionCode: cur.regionCode } : {}),
        places: { placeInfos: places.map((p) => ({ placeName: p.name, placeId: p.placeId })) },
      },
    },
  };
}

/** What the screen shows for the field. */
export interface AreaValue { type: ServiceAreaType | null; places: string[] }
export const areaValue = (sa: TruthServiceArea | undefined): AreaValue => ({ type: sa?.type ?? null, places: (sa?.places ?? []).map((p) => p.name) });

// ── Finding a region's Place ID ──────────────────────────────────────────────

const REGION_TYPES = new Set(['locality', 'administrative_area_level_1', 'administrative_area_level_2', 'administrative_area_level_3', 'sublocality', 'sublocality_level_1', 'neighborhood', 'colloquial_area']);
const TEXT_SEARCH = 'https://places.googleapis.com/v1/places:searchText';

/** Places API (New) text search for a city or region in Israel; the first result that is a region. Null: not found, or no key. */
export async function findRegion(name: string, f: typeof fetch = fetch, apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim() ?? ''): Promise<TruthAreaPlace | null> {
  const q = line(name, 60);
  if (!apiKey || q.length < 2) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await f(TEXT_SEARCH, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey, 'x-goog-fieldmask': 'places.id,places.displayName,places.types' },
      body: JSON.stringify({ textQuery: `${q}, ישראל`, languageCode: 'he', regionCode: 'IL', pageSize: 5 }),
    });
    if (!r.ok) return null;
    const b = (await r.json().catch(() => ({}))) as { places?: { id?: unknown; displayName?: { text?: unknown }; types?: unknown }[] };
    for (const p of Array.isArray(b.places) ? b.places : []) {
      const types = Array.isArray(p?.types) ? p.types : [];
      if (typeof p?.id === 'string' && /^[A-Za-z0-9_-]{10,300}$/.test(p.id) && types.some((t) => REGION_TYPES.has(String(t)))) {
        return { name: q, placeId: p.id };
      }
    }
    return null;
  } catch { return null; } finally { clearTimeout(timer); }
}
