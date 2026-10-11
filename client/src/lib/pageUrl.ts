// Public URL of a published page: its own subdomain when it has one
// (cafe-dani.pagey.co.il), else the always-valid /p/<slug> path.
export const ROOT_DOMAIN = 'pagey.co.il';

export function publicPageUrl(slug: string, subdomain?: string | null): string {
  return subdomain ? `https://${subdomain}.${ROOT_DOMAIN}` : `https://${ROOT_DOMAIN}/p/${slug}`;
}

/** Short display form without protocol, for cards ("cafe-dani.pagey.co.il"). */
export function publicPageLabel(slug: string, subdomain?: string | null): string {
  return subdomain ? `${subdomain}.${ROOT_DOMAIN}` : `${ROOT_DOMAIN}/p/${slug}`;
}

/**
 * When the visitor arrived on a page's own subdomain, the server injects the
 * page slug into the HTML (og.controller.ts). null on the main site.
 */
export function subdomainPageSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const s = (window as unknown as { __PAGEY_SLUG__?: unknown }).__PAGEY_SLUG__;
  return typeof s === 'string' && s ? s : null;
}
