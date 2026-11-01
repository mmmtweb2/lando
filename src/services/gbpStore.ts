import { supabase } from '../config/supabase';

// gbp_connections (migration 033). The refresh token column holds ciphertext only.

export class GbpStoreError extends Error {
  constructor(public readonly code: 'not_migrated' | 'db', message: string) { super(message); }
}
const wrap = (e: { code?: string; message: string }) =>
  e.code === '42P01' ? new GbpStoreError('not_migrated', 'gbp_connections does not exist') : new GbpStoreError('db', e.message);

export interface Connection { email: string; refresh_token_enc: string; location_name: string | null; status: 'active' | 'needs_reconnect' }
const COLS = 'email, refresh_token_enc, location_name, status';

export async function getConnection(email: string): Promise<Connection | null> {
  const { data, error } = await supabase.from('gbp_connections').select(COLS).eq('email', email).maybeSingle();
  if (error) throw wrap(error);
  return (data as Connection | null) ?? null;
}

/** A new connection resets the chosen location (the Google account may be a different one). */
export async function saveConnection(email: string, tokenEnc: string, scope: string | null): Promise<void> {
  const { error } = await supabase.from('gbp_connections').upsert({
    email, refresh_token_enc: tokenEnc, scope, location_name: null, status: 'active', last_error: null,
    connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'email' });
  if (error) throw wrap(error);
}

export async function setLocation(email: string, location: string): Promise<void> {
  const { error } = await supabase.from('gbp_connections').update({ location_name: location, updated_at: new Date().toISOString() }).eq('email', email);
  if (error) throw wrap(error);
}

export async function markNeedsReconnect(email: string, why: string): Promise<void> {
  const { error } = await supabase.from('gbp_connections')
    .update({ status: 'needs_reconnect', last_error: why.slice(0, 200), updated_at: new Date().toISOString() }).eq('email', email);
  if (error) throw wrap(error);
}

export async function deleteConnection(email: string): Promise<void> {
  const { error } = await supabase.from('gbp_connections').delete().eq('email', email);
  if (error) throw wrap(error);
}
