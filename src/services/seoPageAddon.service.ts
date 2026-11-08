// The landing page that comes with a "with page" promotion plan (task #30, billing-spec §1).
//
// Rules (Moshe, 2026-11-08):
//  • monthly_page / annual_page include ONE published landing page for as long as the subscription
//    is active. It is published without spending a page credit.
//  • When the subscription is not active (canceled, ended, or in debt beyond the grace) the page is
//    FROZEN: offline, content and leads kept. A new/renewed subscription brings it back.
//  • A second page is bought separately at the single-page price.
//
// This file knows nothing about subscriptions: callers pass in `access` (is the add-on active right
// now, and until when), so there is no import cycle with seoSubscription.service.ts. All reads degrade
// to "nothing claimed" when migration 047 has not been run, so deploying the code first is safe.

import { supabase } from '../config/supabase';

export interface AddonAccess {
  /** The account holds a "with page" plan whose subscription is currently entitled (grace included). */
  active: boolean;
  /** End of the paid period (ISO), written to the page's expires_at for display. */
  periodEnd: string | null;
}

interface ClaimRow { email: string; page_id: string; subscription_id: string | null }

const MISSING = (e: { code?: string; message?: string }) =>
  e.code === '42P01' || /seo_addon_pages/.test(e.message ?? '') && /does not exist|schema cache/.test(e.message ?? '');

export async function getClaim(email: string): Promise<ClaimRow | null> {
  const { data, error } = await supabase
    .from('seo_addon_pages').select('email, page_id, subscription_id').eq('email', email.trim().toLowerCase()).maybeSingle();
  if (error) { if (!MISSING(error)) console.error('[ADDON] claim read failed:', error.message); return null; }
  return (data as ClaimRow | null) ?? null;
}

/** Page ids the renewal sweeps must leave alone (not renewed for 99, not reminded, never auto-deleted). */
export async function addonPageIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from('seo_addon_pages').select('page_id').limit(5000);
  if (error) { if (!MISSING(error)) console.error('[ADDON] id list failed:', error.message); return new Set(); }
  return new Set(((data ?? []) as Array<{ page_id: string }>).map(r => r.page_id));
}

export async function isAddonPage(pageId: string): Promise<boolean> {
  const { data, error } = await supabase.from('seo_addon_pages').select('page_id').eq('page_id', pageId).maybeSingle();
  if (error) return false;
  return !!data;
}

async function pageExists(id: string): Promise<boolean> {
  const { data } = await supabase.from('landing_pages').select('id').eq('id', id).maybeSingle();
  return !!data;
}

/**
 * Can `pageId` be published as the account's included page? Only when the add-on is active and the
 * account has not already used it on a different (still existing) page. The same page may be
 * published again (it was unpublished and is being put back).
 */
export async function canUseAddon(email: string, pageId: string, access: AddonAccess): Promise<boolean> {
  if (!access.active) return false;
  const claim = await getClaim(email);
  if (!claim || claim.page_id === pageId) return true;
  return !(await pageExists(claim.page_id));   // the claimed page was deleted: the slot is free again
}

/**
 * Records `pageId` as the account's included page BEFORE publishing it (so two parallel publishes
 * cannot both get a free page). Returns false when someone else holds the slot or the table is missing.
 */
export async function claimAddonPage(email: string, pageId: string, subscriptionId: string | null): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const claim = await getClaim(e);
  if (claim?.page_id === pageId) return true;
  if (claim) {
    if (await pageExists(claim.page_id)) return false;
    await supabase.from('seo_addon_pages').delete().eq('email', e).eq('page_id', claim.page_id);
  }
  const { error } = await supabase.from('seo_addon_pages').insert({ email: e, page_id: pageId, subscription_id: subscriptionId });
  if (error) { if (error.code !== '23505') console.error('[ADDON] claim failed:', error.message); return false; }
  return true;
}

export async function releaseAddonClaim(email: string, pageId: string): Promise<void> {
  await supabase.from('seo_addon_pages').delete().eq('email', email.trim().toLowerCase()).eq('page_id', pageId);
}

/**
 * Bring the included page in line with the subscription:
 *  - add-on active: a frozen page comes back, a published one gets expires_at = end of the paid period;
 *  - add-on not active: a published page is frozen (never deleted).
 * Idempotent and compare-and-swap on status. Returns what it did.
 */
export async function reconcileAddonPage(email: string, access: AddonAccess): Promise<'none' | 'frozen' | 'unfrozen' | 'refreshed' | 'unchanged'> {
  const claim = await getClaim(email);
  if (!claim) return 'none';
  const { data } = await supabase.from('landing_pages').select('id, status, expires_at').eq('id', claim.page_id).maybeSingle();
  const page = data as { id: string; status: string; expires_at: string | null } | null;
  if (!page) return 'none';

  if (access.active) {
    if (page.status === 'frozen') {
      const { data: up } = await supabase.from('landing_pages')
        .update({ status: 'published', frozen_at: null, expires_at: access.periodEnd })
        .eq('id', page.id).eq('status', 'frozen').select('id').maybeSingle();
      return up ? 'unfrozen' : 'unchanged';
    }
    if (page.status === 'published' && access.periodEnd && page.expires_at !== access.periodEnd) {
      await supabase.from('landing_pages').update({ expires_at: access.periodEnd }).eq('id', page.id).eq('status', 'published');
      return 'refreshed';
    }
    return 'unchanged';
  }

  if (page.status === 'published') {
    const { data: fr } = await supabase.from('landing_pages')
      .update({ status: 'frozen', frozen_at: new Date().toISOString() })
      .eq('id', page.id).eq('status', 'published').select('id').maybeSingle();
    return fr ? 'frozen' : 'unchanged';
  }
  return 'unchanged';
}

/** What the dashboard shows about the included page. */
export async function addonPageInfo(email: string): Promise<{ pageId: string | null; status: string | null }> {
  const claim = await getClaim(email);
  if (!claim) return { pageId: null, status: null };
  const { data } = await supabase.from('landing_pages').select('id, status').eq('id', claim.page_id).maybeSingle();
  const page = data as { id: string; status: string } | null;
  return page ? { pageId: page.id, status: page.status } : { pageId: null, status: null };
}
