import { supabase } from '../config/supabase';

/**
 * Delete the leads of a page AND of all its child pages (parent_id = pageId).
 *
 * `leads.landing_page_id` (leads_landing_page_id_fkey) has no ON DELETE clause,
 * so a page that still has leads — or whose children still have leads, because
 * deleting the parent cascades to the children via parent_id — cannot be
 * deleted. Every place that deletes a page deletes its leads first through this
 * helper and must NOT delete the page when it returns an error message.
 *
 * Returns null on success, or an error message.
 */
export async function deleteLeadsForPageTree(pageId: string): Promise<string | null> {
  const { data: children, error: childErr } = await supabase
    .from('landing_pages')
    .select('id')
    .eq('parent_id', pageId);

  if (childErr) return childErr.message;

  const ids = [pageId, ...((children ?? []) as { id: string }[]).map((c) => c.id)];
  const { error } = await supabase.from('leads').delete().in('landing_page_id', ids);
  return error ? error.message : null;
}
