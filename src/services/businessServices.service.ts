// Per-business list of services (migration 037). Used to put the service in review-request messages.
// Owner-scoped: every call checks the business belongs to the caller.

import { supabase } from '../config/supabase';

export const MAX_SERVICES = 8;
export const MAX_SERVICE_LEN = 40;

export class ServicesError extends Error {
  constructor(public readonly code: 'bad_input' | 'not_found' | 'not_migrated', message = code) { super(message); }
}

/** Trims, collapses spaces, drops empties / links / control characters and duplicates. Throws on too many items. */
export function normalizeServices(input: unknown): string[] {
  if (!Array.isArray(input)) throw new ServicesError('bad_input');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') throw new ServicesError('bad_input');
    // eslint-disable-next-line no-control-regex
    const s = raw.replace(/[\u0000-\u001f\u007f‎‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (s.length > MAX_SERVICE_LEN || /https?:|www\.|@/i.test(s)) throw new ServicesError('bad_input');
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  if (out.length > MAX_SERVICES) throw new ServicesError('bad_input');
  return out;
}

const missing = (m?: string) => /does not exist|schema cache|42P01|PGRST205/i.test(m ?? '');

async function ownsBusiness(email: string, businessId: string): Promise<boolean> {
  const { data, error } = await supabase.from('seo_businesses').select('id').eq('id', businessId).eq('owner_email', email).maybeSingle();
  if (error) throw new Error(`ownsBusiness: ${error.message}`);
  return !!data;
}

export async function getServices(email: string, businessId: string): Promise<string[]> {
  if (!(await ownsBusiness(email, businessId))) throw new ServicesError('not_found');
  const { data, error } = await supabase.from('seo_business_services').select('services').eq('business_id', businessId).maybeSingle();
  if (error) {
    if (missing(error.message)) return []; // before the migration the picker simply shows nothing
    throw new Error(`getServices: ${error.message}`);
  }
  try { return normalizeServices((data as { services?: unknown } | null)?.services ?? []); } catch { return []; }
}

export async function setServices(email: string, businessId: string, input: unknown): Promise<string[]> {
  const list = normalizeServices(input);
  if (!(await ownsBusiness(email, businessId))) throw new ServicesError('not_found');
  const { error } = await supabase.from('seo_business_services')
    .upsert({ business_id: businessId, services: list, updated_at: new Date().toISOString() }, { onConflict: 'business_id' });
  if (error) {
    if (missing(error.message)) throw new ServicesError('not_migrated');
    throw new Error(`setServices: ${error.message}`);
  }
  return list;
}
