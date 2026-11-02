import { supabase } from '../config/supabase';
import { isEntitled } from './entitlements.service';

// Admin tool: give someone the Google-promotion product for free (a "manual" grant), with an end
// date or without one, and take it back. Writes the same user_products row an SQL grant would.
// A paying (SUMIT) subscriber is never touched here.

export class BetaAccessError extends Error {
  constructor(public readonly code: 'bad_email' | 'bad_days' | 'no_account' | 'paying' | 'db', message?: string) { super(message ?? code); }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_DAYS = 3650;

export interface GrantRow {
  email: string; status: string; source: string; current_period_end: string | null; started_at: string; active: boolean;
}

export function normEmail(v: unknown): string {
  if (typeof v !== 'string') throw new BetaAccessError('bad_email');
  const e = v.trim().toLowerCase();
  if (!EMAIL.test(e) || e.length > 254) throw new BetaAccessError('bad_email');
  return e;
}

/** days: positive integer, or null for "no end date". */
export function normDays(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) throw new BetaAccessError('bad_days');
  return n;
}

export async function listGrants(now = new Date()): Promise<GrantRow[]> {
  const { data, error } = await supabase.from('user_products')
    .select('email, status, source, current_period_end, started_at')
    .eq('product', 'seo_autopilot').order('started_at', { ascending: false }).limit(500);
  if (error) throw new BetaAccessError('db', error.message);
  return ((data ?? []) as Omit<GrantRow, 'active'>[]).map((r) => ({ ...r, active: isEntitled(r, now) }));
}

export async function grantAccess(emailIn: unknown, daysIn: unknown, now = new Date()): Promise<GrantRow> {
  const email = normEmail(emailIn);
  const days = normDays(daysIn);

  const { data: acct, error: aErr } = await supabase.from('user_profiles').select('email').eq('email', email).maybeSingle();
  if (aErr) throw new BetaAccessError('db', aErr.message);
  if (!acct) throw new BetaAccessError('no_account');

  const { data: cur, error: cErr } = await supabase.from('user_products')
    .select('status, source, current_period_end').eq('email', email).eq('product', 'seo_autopilot').maybeSingle();
  if (cErr) throw new BetaAccessError('db', cErr.message);
  const c = cur as { status: string; source: string; current_period_end: string | null } | null;
  if (c && c.source === 'sumit' && isEntitled(c, now)) throw new BetaAccessError('paying');

  const end = days === null ? null : new Date(now.getTime() + days * 86400000).toISOString();
  const row = { email, product: 'seo_autopilot', status: 'active', source: 'manual', current_period_end: end };
  const { error } = await supabase.from('user_products').upsert(row, { onConflict: 'email,product' });
  if (error) throw new BetaAccessError('db', error.message);
  return { email, status: 'active', source: 'manual', current_period_end: end, started_at: now.toISOString(), active: true };
}

/** Ends a manual grant now. Never ends a paid subscription. */
export async function revokeAccess(emailIn: unknown, now = new Date()): Promise<void> {
  const email = normEmail(emailIn);
  const { data: cur, error: cErr } = await supabase.from('user_products')
    .select('status, source, current_period_end').eq('email', email).eq('product', 'seo_autopilot').maybeSingle();
  if (cErr) throw new BetaAccessError('db', cErr.message);
  const c = cur as { status: string; source: string; current_period_end: string | null } | null;
  if (!c) return;
  if (c.source === 'sumit' && isEntitled(c, now)) throw new BetaAccessError('paying');
  const { error } = await supabase.from('user_products')
    .update({ status: 'canceled', current_period_end: now.toISOString() }).eq('email', email).eq('product', 'seo_autopilot');
  if (error) throw new BetaAccessError('db', error.message);
}
