// Which landing-page look to render. "Pinkas" (v3) is the default for every
// regular page; ?design=1 (classic) and ?design=2 (v2) are the opt-outs;
// ?design=3 forces v3 (also for child/SEO pages, which otherwise keep their look).
export function isDesignV3(designParam: string | null, page: { parent_id?: string | null } | null | undefined): boolean {
  if (designParam === '3') return true;
  if (designParam === '1' || designParam === '2') return false;
  return !!page && !page.parent_id;
}
