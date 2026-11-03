// Carries the business picked in /start (seo_journey.place_id) over to the table the dashboard reads
// (seo_businesses, one row per saved Google place). Without this the customer is asked to pick the same
// business a second time after activation, and the review cards stay empty.
//
// Places terms: only the place_id comes from the journey. The name is read from Google ONCE, now, at the
// moment of linking, exactly like POST /api/seo/businesses does (the name the customer confirmed as "my
// business" is the only Places value kept there). Nothing else is stored, everything else is fetched live.
//
// Safe to call as often as you like, and never throws: the callers are page loads and the activation click.
//  - runs only when the journey has a place_id and has not been linked yet (seo_journey.business_linked_at, migration 042);
//  - only when the account has no saved business of its own (a customer who already connected one keeps it);
//  - sets the marker, so a business the customer removes later is not added back.

import { supabase } from '../config/supabase';
import { fetchPlace, placesConfigured } from './places.service';
import { addBusiness, listBusinesses } from './seoBusinesses.service';

export type LinkResult = 'linked' | 'already' | 'nothing' | 'skipped';

export async function linkJourneyBusiness(email: string, now = new Date()): Promise<LinkResult> {
  try {
    const { data, error } = await supabase.from('seo_journey').select('place_id, business_linked_at').eq('email', email).maybeSingle();
    // Migration 042 not run yet (or any read problem): do nothing rather than risk re-adding a removed business.
    if (error) return 'skipped';
    const row = data as { place_id: string | null; business_linked_at: string | null } | null;
    if (!row || !row.place_id) return 'nothing';
    if (row.business_linked_at) return 'already';

    const mark = () => supabase.from('seo_journey').update({ business_linked_at: now.toISOString() }).eq('email', email);

    const existing = await listBusinesses(email);
    if (existing.length > 0) { await mark(); return 'already'; } // the customer connected a business themselves
    if (!placesConfigured()) return 'skipped';

    const place = await fetchPlace(row.place_id);
    const r = await addBusiness(email, { placeId: place.id, name: place.displayName?.text ?? '', websiteUrl: null });
    if (!r.ok) return 'skipped';
    await mark();
    return 'linked';
  } catch (e) {
    console.error('[JOURNEY] link business failed:', e instanceof Error ? e.message : e);
    return 'skipped';
  }
}
