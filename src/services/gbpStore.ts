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

/**
 * The connection stopped working. Only the call that moves it from active to needs_reconnect tells
 * the customer (one email per break, reconnectNotice.ts); repeated calls just refresh the reason.
 * `notify` is replaceable for tests.
 */
export async function markNeedsReconnect(
  email: string, why: string,
  notify: (email: string) => Promise<unknown> = async (e) => (await import('./reconnectNotice')).sendReconnectNotice(e),
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('gbp_connections')
    .update({ status: 'needs_reconnect', last_error: why.slice(0, 200), updated_at: now }).eq('email', email).eq('status', 'active').select('email');
  if (error) throw wrap(error);
  const moved = ((data ?? []) as unknown[]).length > 0;
  if (!moved) {
    // Already marked (or no connection): keep the latest reason, no second email.
    await supabase.from('gbp_connections').update({ last_error: why.slice(0, 200), updated_at: now }).eq('email', email).eq('status', 'needs_reconnect');
    return false;
  }
  console.error('[GBP] ALERT a Google connection needs reconnecting', { email, why: why.slice(0, 60) });
  void notify(email).catch(() => undefined);
  return true;
}

export async function deleteConnection(email: string): Promise<void> {
  const { error } = await supabase.from('gbp_connections').delete().eq('email', email);
  if (error) throw wrap(error);
}
