// Does the Google Business Profile the customer connected (OAuth, the owner's/manager's own Google
// account) match the business they picked in the search? QA 24.11 (trust): picking a search result
// proves nothing about ownership, while the Google sign-in does. When the two disagree the customer
// gets a clear choice instead of us silently showing one business's numbers under another's name.
// Pure: no I/O.

import type { GbpLocation } from './gbpGoogle';

export interface PickedBusiness { id: string; name: string; google_place_id: string | null }

export type PlaceMatchStatus = 'match' | 'mismatch' | 'unknown';
export interface PlaceMatch {
  status: PlaceMatchStatus;
  /** The business picked in the search (the first saved one when nothing matches). */
  selected: { id: string; name: string; placeId: string | null } | null;
  /** The listing Google says this account manages. */
  connected: { title: string; placeId: string | null };
}

const norm = (s: string) => s.toLowerCase().replace(/[״׳"'`’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * match    → the connected listing's place id is one of the picked businesses (or, when Google gives no
 *            place id, the names are the same).
 * mismatch → Google gives a place id and it is none of the picked businesses (or no place id and a
 *            different name). The customer must choose.
 * unknown  → nothing was picked yet, or nothing to compare (no place id and no names).
 */
export function placeMatch(loc: Pick<GbpLocation, 'title' | 'placeId'>, picked: PickedBusiness[]): PlaceMatch {
  const connected = { title: loc.title ?? '', placeId: loc.placeId ?? null };
  const withPlace = picked.filter((b) => !!b.google_place_id);
  if (withPlace.length === 0) return { status: 'unknown', selected: null, connected };
  if (loc.placeId) {
    const hit = withPlace.find((b) => b.google_place_id === loc.placeId);
    if (hit) return { status: 'match', selected: { id: hit.id, name: hit.name, placeId: hit.google_place_id }, connected };
    const first = withPlace[0];
    return { status: 'mismatch', selected: { id: first.id, name: first.name, placeId: first.google_place_id }, connected };
  }
  const title = norm(loc.title ?? '');
  const first = withPlace[0];
  if (!title) return { status: 'unknown', selected: { id: first.id, name: first.name, placeId: first.google_place_id }, connected };
  const byName = withPlace.find((b) => norm(b.name) === title);
  if (byName) return { status: 'match', selected: { id: byName.id, name: byName.name, placeId: byName.google_place_id }, connected };
  return { status: 'mismatch', selected: { id: first.id, name: first.name, placeId: first.google_place_id }, connected };
}
