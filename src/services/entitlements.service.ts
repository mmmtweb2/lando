// Product entitlements (migration 027) — which products an account may use.
//
//  • pagey_pages  — EVERY account has it, implicitly (no row). It is the product the
//                   app has always been, so existing customers are unchanged.
//  • seo_autopilot — the Google-promotion product; entitled only through a row in
//                   user_products.
//
// Fail-closed AND fail-safe: if the lookup fails (e.g. this code is deployed before
// migration 027 has been run) the account simply reads as "no seo_autopilot" — the
// existing Pagey flows never see an error from here.

import { supabase } from '../config/supabase';

export type ProductKey = 'seo_autopilot';

export interface Entitlements {
  pagey_pages: true;
  seo_autopilot: boolean;
}

export interface UserProductRow {
  product: string;
  status: string;
  current_period_end: string | null;
}

/**
 * Is this user_products row currently entitling? 'active' and 'trialing' do;
 * 'canceled' and 'past_due' do not. A row whose current_period_end has passed does
 * not either, whatever its status says (a stale 'active' must not grant access).
 */
export function isEntitled(row: Pick<UserProductRow, 'status' | 'current_period_end'>, now = new Date()): boolean {
  if (row.status !== 'active' && row.status !== 'trialing') return false;
  if (row.current_period_end && new Date(row.current_period_end).getTime() <= now.getTime()) return false;
  return true;
}

export async function getEntitlements(email: string): Promise<Entitlements> {
  const base: Entitlements = { pagey_pages: true, seo_autopilot: false };
  try {
    const { data, error } = await supabase
      .from('user_products')
      .select('product, status, current_period_end')
      .eq('email', email.trim().toLowerCase());
    if (error) {
      console.error('[ENTITLEMENTS] lookup failed:', error.message);
      return base;
    }
    for (const row of (data ?? []) as UserProductRow[]) {
      if (row.product === 'seo_autopilot' && isEntitled(row)) base.seo_autopilot = true;
    }
  } catch (e) {
    console.error('[ENTITLEMENTS] lookup threw:', e);
  }
  return base;
}

export async function hasProduct(email: string, product: ProductKey): Promise<boolean> {
  return (await getEntitlements(email))[product];
}
