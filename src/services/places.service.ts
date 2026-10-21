// Google Places API (New) client (Stage 5.5.2).
//
//   • SERVER ONLY. The API key lives in GOOGLE_PLACES_API_KEY and is never sent to the
//     browser; the client calls our /api/seo/places/* routes instead.
//   • Field masks are explicit and minimal: Places bills by the fields requested.
//   • Never logs the key or full upstream bodies.

import { buildAudit, type BusinessAudit, type PlaceSnapshot } from './placesAudit';

const BASE = 'https://places.googleapis.com/v1';
const TIMEOUT_MS = 8000;

/** Fields we read for the Audit. Keep in sync with PlaceSnapshot. */
export const PLACE_FIELD_MASK = [
  'id', 'displayName', 'formattedAddress', 'rating', 'userRatingCount',
  'nationalPhoneNumber', 'websiteUri', 'googleMapsUri', 'businessStatus',
  'primaryTypeDisplayName', 'photos',
].join(',');

export class PlacesError extends Error {
  constructor(public readonly code: 'not_configured' | 'bad_request' | 'not_found' | 'upstream', message: string) {
    super(message);
  }
}

export interface PlaceSuggestion {
  placeId: string;
  /** Main line, e.g. the business name. */
  name: string;
  /** Secondary line, e.g. the address. */
  details: string;
}

function apiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) throw new PlacesError('not_configured', 'GOOGLE_PLACES_API_KEY is not set');
  return key;
}

export function placesConfigured(): boolean {
  return !!process.env.GOOGLE_PLACES_API_KEY?.trim();
}

/** Place IDs are URL-safe tokens. Rejecting anything else keeps user input out of the URL path. */
export function isValidPlaceId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{10,300}$/.test(id);
}

async function call(url: string, init: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (res.status === 404) throw new PlacesError('not_found', 'place not found');
    if (res.status === 400) throw new PlacesError('bad_request', 'places rejected the request');
    if (!res.ok) {
      // Status only — the body may echo request details.
      console.error('[PLACES] upstream status', res.status);
      throw new PlacesError('upstream', `places upstream ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    if (e instanceof PlacesError) throw e;
    console.error('[PLACES] request failed:', (e as Error).name);
    throw new PlacesError('upstream', 'places request failed');
  } finally {
    clearTimeout(timer);
  }
}

/** Business-name search ("type the business name and city"). */
export async function autocompleteBusinesses(input: string, sessionToken?: string): Promise<PlaceSuggestion[]> {
  const q = input.trim().slice(0, 120);
  if (q.length < 2) return [];
  const body: Record<string, unknown> = {
    input: q,
    languageCode: 'he',
    regionCode: 'IL',
  };
  if (sessionToken && /^[A-Za-z0-9_-]{8,100}$/.test(sessionToken)) body.sessionToken = sessionToken;

  const json = (await call(`${BASE}/places:autocomplete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey(),
      'X-Goog-FieldMask':
        'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat',
    },
    body: JSON.stringify(body),
  })) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
      };
    }>;
  };

  const out: PlaceSuggestion[] = [];
  for (const s of json.suggestions ?? []) {
    const p = s.placePrediction;
    if (!p?.placeId) continue;
    out.push({
      placeId: p.placeId,
      name: p.structuredFormat?.mainText?.text ?? '',
      details: p.structuredFormat?.secondaryText?.text ?? '',
    });
  }
  return out.slice(0, 8);
}

export async function fetchPlace(placeId: string): Promise<PlaceSnapshot> {
  if (!isValidPlaceId(placeId)) throw new PlacesError('bad_request', 'invalid place id');
  const json = await call(`${BASE}/places/${encodeURIComponent(placeId)}?languageCode=he&regionCode=IL`, {
    method: 'GET',
    headers: { 'X-Goog-Api-Key': apiKey(), 'X-Goog-FieldMask': PLACE_FIELD_MASK },
  });
  return json as PlaceSnapshot;
}

export async function auditPlace(placeId: string): Promise<BusinessAudit> {
  return buildAudit(await fetchPlace(placeId));
}
