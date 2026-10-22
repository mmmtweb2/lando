// Businesses a seo_autopilot customer promotes (Stage 6.1). One row per Google place.
// Table: seo_businesses (migration 027). Server-side only (service-role client).

import { supabase } from '../config/supabase';

export const MAX_BUSINESSES_PER_ACCOUNT = 3;

export interface SeoBusiness {
  id: string;
  name: string;
  google_place_id: string | null;
  website_url: string | null;
  landing_page_id: string | null;
  created_at: string;
}

const COLS = 'id, name, google_place_id, website_url, landing_page_id, created_at';

export async function listBusinesses(email: string): Promise<SeoBusiness[]> {
  const { data, error } = await supabase
    .from('seo_businesses')
    .select(COLS)
    .eq('owner_email', email)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listBusinesses: ${error.message}`);
  return (data ?? []) as SeoBusiness[];
}

export type AddResult =
  | { ok: true; business: SeoBusiness; created: boolean }
  | { ok: false; reason: 'limit' };

/** Idempotent per (owner, place): saving the same place twice returns the existing row. */
export async function addBusiness(
  email: string,
  b: { placeId: string; name: string; websiteUrl: string | null },
): Promise<AddResult> {
  const existing = await listBusinesses(email);
  const same = existing.find(x => x.google_place_id === b.placeId);
  if (same) return { ok: true, business: same, created: false };
  if (existing.length >= MAX_BUSINESSES_PER_ACCOUNT) return { ok: false, reason: 'limit' };

  const { data, error } = await supabase
    .from('seo_businesses')
    .insert({
      owner_email: email,
      name: b.name.slice(0, 200) || 'עסק',
      google_place_id: b.placeId,
      website_url: b.websiteUrl ? b.websiteUrl.slice(0, 500) : null,
    })
    .select(COLS)
    .single();
  if (error) {
    // Lost a race with the unique (owner_email, google_place_id) index: return the winner.
    const again = (await listBusinesses(email)).find(x => x.google_place_id === b.placeId);
    if (again) return { ok: true, business: again, created: false };
    throw new Error(`addBusiness: ${error.message}`);
  }
  return { ok: true, business: data as SeoBusiness, created: true };
}

/** Owner-scoped delete. Returns whether a row was removed. */
export async function removeBusiness(email: string, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('seo_businesses')
    .delete()
    .eq('id', id)
    .eq('owner_email', email)
    .select('id');
  if (error) throw new Error(`removeBusiness: ${error.message}`);
  return (data ?? []).length > 0;
}
