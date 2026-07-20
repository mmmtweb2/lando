import { supabase } from './supabase';

/**
 * fetch() wrapper that attaches the logged-in user's Supabase access token as
 * `Authorization: Bearer <token>`. Use this for every backend call that the
 * server protects with requireAuth / requireOwnPage / requireAdmin (publish,
 * save, delete, regenerate, admin actions).
 *
 * Falls back to a plain request (no header) if there is no session, so the
 * server can respond with a clean 401 rather than the client crashing.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
