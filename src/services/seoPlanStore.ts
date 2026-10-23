// Stage 8 — persistence for a business's content plan and its generated kits.
// Tables/columns come from migration 028. Everything here is OWNER-SCOPED: every query
// filters on owner_email (businesses) or goes through an owned business (kits).
//
// Fail-safe for deploy order: if 028 has not been run yet, the new columns/table do not
// exist; callers get PlanStoreError('not_migrated') and the rest of the product (which never
// selects these columns) keeps working.

import { supabase } from '../config/supabase';
import type { ContentKit } from './seoContent';
import type { PlanSettings } from './seoPhrases';

export class PlanStoreError extends Error {
  constructor(public readonly code: 'not_migrated' | 'db', message: string) {
    super(message);
  }
}

export const MAX_KITS_PER_BUSINESS = 20;

function fail(e: { message: string; code?: string }, what: string): never {
  // 42703 undefined_column, 42P01 undefined_table, PGRST204/PGRST205 = PostgREST schema-cache misses.
  if (e.code === '42703' || e.code === '42P01' || e.code === 'PGRST204' || e.code === 'PGRST205') {
    throw new PlanStoreError('not_migrated', `${what}: migration 028 missing`);
  }
  throw new PlanStoreError('db', `${what}: ${e.message}`);
}

export interface OwnedBusiness {
  id: string;
  name: string;
  google_place_id: string | null;
  business_type: string | null;
  service_areas: string[];
  long_tail_phrases: string[];
  facts: string | null;
  landing_page_id: string | null;
}

const COLS = 'id, name, google_place_id, business_type, service_areas, long_tail_phrases, facts, landing_page_id';

export async function getOwnedBusiness(email: string, id: string): Promise<OwnedBusiness | null> {
  const { data, error } = await supabase
    .from('seo_businesses')
    .select(COLS)
    .eq('id', id)
    .eq('owner_email', email)
    .maybeSingle();
  if (error) fail(error, 'getOwnedBusiness');
  return (data as OwnedBusiness | null) ?? null;
}

export async function saveSettings(email: string, id: string, s: PlanSettings): Promise<OwnedBusiness | null> {
  const { data, error } = await supabase
    .from('seo_businesses')
    .update({
      business_type: s.businessType,
      service_areas: s.serviceAreas,
      long_tail_phrases: s.phrases,
      facts: s.facts || null,
    })
    .eq('id', id)
    .eq('owner_email', email)
    .select(COLS)
    .maybeSingle();
  if (error) fail(error, 'saveSettings');
  return (data as OwnedBusiness | null) ?? null;
}

export interface StoredKit { id: string; phrase: string; kit: ContentKit; created_at: string }

export async function listKits(businessId: string): Promise<StoredKit[]> {
  const { data, error } = await supabase
    .from('seo_content_kits')
    .select('id, phrase, kit, created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false });
  if (error) fail(error, 'listKits');
  return (data ?? []) as StoredKit[];
}

export async function addKit(businessId: string, phrase: string, kit: ContentKit): Promise<StoredKit> {
  const { data, error } = await supabase
    .from('seo_content_kits')
    .insert({ business_id: businessId, phrase, kit })
    .select('id, phrase, kit, created_at')
    .single();
  if (error) fail(error, 'addKit');
  return data as StoredKit;
}

/** Deletes a kit only if it belongs to this (already ownership-checked) business. */
export async function removeKit(businessId: string, kitId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('seo_content_kits')
    .delete()
    .eq('id', kitId)
    .eq('business_id', businessId)
    .select('id');
  if (error) fail(error, 'removeKit');
  return (data ?? []).length > 0;
}
