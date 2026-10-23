// Stage 8.2b — persistence for SEO child pages of a customer's Pagey page.
// Children live in landing_pages (migration 025): parent_id + sub_slug, excluded from quotas,
// owner page lists and lifecycle sweeps, and shown only while the parent is published.
// Every function is owner-scoped through the parent page's owner_email.

import { supabase } from '../config/supabase';
import { canonicalUrl, subSlugFromPhrase } from './subdomain.service';

type Json = Record<string, any>;

export interface ParentPage {
  id: string; slug: string; subdomain: string | null; status: string | null; owner_email: string;
  business_name: string; phone_number: string; email: string | null; address: string | null;
  business_hours: string | null; about_business: string | null; image_source: string | null;
  ai_content: Json; logo_url: string | null; user_images: unknown; user_provided_text: string | null;
  design_style: string | null; facebook_url: string | null; instagram_url: string | null;
  enable_form: boolean | null; page_goal: string | null; external_link: string | null;
}

const PARENT_COLS =
  'id, slug, subdomain, status, owner_email, business_name, phone_number, email, address, business_hours, ' +
  'about_business, image_source, ai_content, logo_url, user_images, user_provided_text, design_style, ' +
  'facebook_url, instagram_url, enable_form, page_goal, external_link';

/** The owner's PARENT page (never a child), or null. */
export async function getOwnedParentPage(email: string, pageId: string): Promise<ParentPage | null> {
  const { data, error } = await supabase
    .from('landing_pages')
    .select(PARENT_COLS)
    .eq('id', pageId)
    .eq('owner_email', email)
    .is('parent_id', null)
    .maybeSingle();
  if (error) throw new Error(`getOwnedParentPage: ${error.message}`);
  return (data as unknown as ParentPage | null) ?? null;
}

/** Links (or unlinks, pageId=null) a saved business to one of the owner's Pagey pages. */
export async function linkLandingPage(email: string, businessId: string, pageId: string | null): Promise<boolean> {
  const { data, error } = await supabase
    .from('seo_businesses')
    .update({ landing_page_id: pageId })
    .eq('id', businessId)
    .eq('owner_email', email)
    .select('id');
  if (error) throw new Error(`linkLandingPage: ${error.message}`);
  return (data ?? []).length > 0;
}

export interface ChildRow {
  id: string; slug: string; sub_slug: string | null; target_keyword: string | null;
  status: string | null; hero_title: string | null;
}

export async function listChildren(parentId: string): Promise<ChildRow[]> {
  const { data, error } = await supabase
    .from('landing_pages')
    .select('id, slug, sub_slug, target_keyword, status, hero_title:ai_content->hero->>title')
    .eq('parent_id', parentId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listChildren: ${error.message}`);
  return (data ?? []) as unknown as ChildRow[];
}

export function childUrl(parent: Pick<ParentPage, 'subdomain'>, c: Pick<ChildRow, 'slug' | 'sub_slug'>): string {
  return canonicalUrl({ slug: c.slug, sub_slug: c.sub_slug }, parent.subdomain);
}

/** Inserts a child page; retries with a short suffix if sub_slug / slug collide. */
export async function insertChild(
  parent: ParentPage, phrase: string, aiContent: Json,
): Promise<ChildRow> {
  const base = subSlugFromPhrase(phrase);
  for (let attempt = 0; attempt < 4; attempt++) {
    const subSlug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await supabase
      .from('landing_pages')
      .insert({
        slug: `${parent.slug}-${subSlug}`,
        business_name: parent.business_name,
        phone_number: parent.phone_number,
        email: parent.email,
        address: parent.address,
        business_hours: parent.business_hours,
        about_business: parent.about_business,
        image_source: parent.image_source,
        ai_content: aiContent,
        logo_url: parent.logo_url,
        user_images: parent.user_images,
        user_provided_text: parent.user_provided_text,
        design_style: parent.design_style,
        facebook_url: parent.facebook_url,
        instagram_url: parent.instagram_url,
        enable_form: parent.enable_form,
        owner_email: parent.owner_email,
        page_goal: parent.page_goal,
        external_link: parent.external_link,
        status: 'published',
        published_at: new Date().toISOString(),
        parent_id: parent.id,
        sub_slug: subSlug,
        target_keyword: phrase,
      })
      .select('id, slug, sub_slug, target_keyword, status')
      .single();
    if (!error) return { ...(data as Json), hero_title: aiContent.hero?.title ?? null } as ChildRow;
    if (error.code !== '23505') throw new Error(`insertChild: ${error.message}`);
  }
  throw new Error('insertChild: could not find a free sub_slug');
}

export type DeleteChildResult = 'deleted' | 'not_found' | 'has_leads';

/**
 * Deletes a child page only if it has NO leads (a customer must never lose an inquiry because
 * they removed a page). leads.landing_page_id has no ON DELETE clause, so we check first.
 */
export async function deleteChild(parentId: string, childId: string): Promise<DeleteChildResult> {
  const { data: child, error: e1 } = await supabase
    .from('landing_pages').select('id').eq('id', childId).eq('parent_id', parentId).maybeSingle();
  if (e1) throw new Error(`deleteChild: ${e1.message}`);
  if (!child) return 'not_found';
  const { data: leads, error: e2 } = await supabase.from('leads').select('id').eq('landing_page_id', childId).limit(1);
  if (e2) throw new Error(`deleteChild: ${e2.message}`);
  if ((leads ?? []).length > 0) return 'has_leads';
  const { error: e3 } = await supabase.from('landing_pages').delete().eq('id', childId).eq('parent_id', parentId);
  if (e3) throw new Error(`deleteChild: ${e3.message}`);
  return 'deleted';
}
