import { Request, Response } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { supabase } from '../config/supabase';
import { getAccountStatus } from '../services/billing.service';
import { canonicalUrl, resolveBPage } from '../services/subdomain.service';
import { buildJsonLdScripts, injectSeoBody, renderSeoBody, SeoPage } from '../services/seoRender';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SITE_URL = 'https://pagey.co.il';

async function loadHtmlShell(): Promise<string> {
  const distPath = path.join(process.cwd(), 'client', 'dist', 'index.html');
  try {
    return await readFile(distPath, 'utf-8');
  } catch {
    // Dev mode fallback — crawlers only need the <head>; the JS bundle handles the rest
    return `<!doctype html>
<html lang="he">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pagey</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;
  }
}

/**
 * Requests that arrive on a page's own subdomain (cafe-dani.pagey.co.il/) are
 * routed here by app.ts with res.locals.pageSlug set. The SPA has no /p/:slug
 * in its URL then, so the slug is injected into the HTML for the client router.
 */
function injectSubdomainSlug(html: string, res: Response): string {
  const slug = res.locals.pageSlug as string | undefined;
  if (!slug || !(res.locals.bySubdomain || res.locals.bPath)) return html;
  const tag = `<script>window.__PAGEY_SLUG__=${JSON.stringify(slug).replace(/</g, '\\u003c')};</script>`;
  return html.replace('</head>', `${tag}\n  </head>`);
}

export async function servePageWithOgTags(req: Request, res: Response): Promise<void> {
  const slug = (res.locals.pageSlug as string | undefined) ?? req.params.slug;

  const { data: page, error } = await supabase
    .from('landing_pages')
    .select('business_name, ai_content, user_images, logo_url, owner_email, status, slug, subdomain, address, phone_number, parent_id, sub_slug, facebook_url, instagram_url')
    .eq('slug', slug)
    .single();

  if (error || !page) {
    // Not found — let the SPA handle the 404 UI
    const shell = await loadHtmlShell();
    res.status(200).setHeader('Content-Type', 'text/html').send(injectSubdomainSlug(shell, res));
    return;
  }

  // A child (SEO) page has no status or expiry of its own — it inherits both from
  // its parent, at read time (no sync). Orphaned child → treated as not found.
  const parentId = (page as { parent_id?: string | null }).parent_id ?? null;
  let parentSubdomain: string | null = null;
  let effectiveStatus = (page as { status?: string | null }).status;
  if (parentId) {
    const { data: parent } = await supabase
      .from('landing_pages')
      .select('status, subdomain')
      .eq('id', parentId)
      .maybeSingle();
    if (!parent) {
      const shell = await loadHtmlShell();
      res.status(200).setHeader('Content-Type', 'text/html').send(injectSubdomainSlug(shell, res));
      return;
    }
    effectiveStatus = (parent as { status?: string | null }).status;
    parentSubdomain = (parent as { subdomain?: string | null }).subdomain ?? null;
  }

  // Draft pages are pre-payment/pre-publish and now only viewable by their
  // owner (enforced in landing.controller.ts's getLandingPage). This route
  // has no way to check ownership — it's hit by unauthenticated link-preview
  // bots (WhatsApp/Facebook/etc.) and by the owner's own first HTML load
  // alike, before any JS/auth runs. So treat a draft exactly like "not
  // found" here too: real business name/description/image must never appear
  // in a shareable link preview before the owner has chosen to publish. The
  // owner's own browser still gets the real draft content a moment later,
  // once the SPA hydrates and calls the (now owner-gated) page-data API.
  //
  // A FROZEN page (expired, past its grace week, not yet renewed) is handled
  // identically here, and — like draft — with NO owner exception, for exactly
  // the same pre-auth reason: this route runs before any JS or auth, so it
  // cannot tell the owner from a WhatsApp link-preview bot.
  //
  // The *friendly* "this page is temporarily offline" message a human visitor
  // sees is served by the SPA a moment later, off the 410 from
  // GET /api/landing/:slug (see getLandingPage). What is withheld HERE is only
  // the link PREVIEW — no business name, description or hero image in the OG
  // tags. A lapsed page must not keep generating rich, live-looking previews in
  // WhatsApp and Facebook that promise a working page and deliver an offline
  // one; that reflects worse on the customer than a plain link does.
  const ogStatus = effectiveStatus;
  if (ogStatus === 'draft' || ogStatus === 'frozen') {
    const shell = await loadHtmlShell();
    res.status(200).setHeader('Content-Type', 'text/html').send(injectSubdomainSlug(shell, res));
    return;
  }

  // Parse first image URL
  let firstImage: string = '';
  try {
    const parsed: unknown =
      typeof page.user_images === 'string' ? JSON.parse(page.user_images) : page.user_images;
    if (Array.isArray(parsed)) {
      firstImage = (parsed as string[]).find(Boolean) ?? '';
    } else if (parsed && typeof parsed === 'object') {
      const store = parsed as { hero_image_url?: string; icon_urls?: string[] };
      firstImage = store.hero_image_url || store.icon_urls?.find(Boolean) || '';
    }
    firstImage = firstImage || page.logo_url || '';
  } catch {
    firstImage = page.logo_url ?? '';
  }

  const description: string =
    (page.ai_content as { seo_description?: string })?.seo_description ||
    (page.ai_content as { hero?: { subtitle?: string } })?.hero?.subtitle ||
    (page.ai_content as { hero?: { slogan?: string } })?.hero?.slogan ||
    (page.ai_content as { about?: { content?: string } })?.about?.content?.slice(0, 150) ||
    'דף נחיתה מקצועי';

  let whiteLabel = false;
  if (page.owner_email) {
    try {
      whiteLabel = (await getAccountStatus(page.owner_email as string)).whiteLabel;
    } catch (e) {
      console.error('servePageWithOgTags: failed to resolve whiteLabel status', e);
    }
  }
  const title = whiteLabel ? `${page.business_name}` : `${page.business_name} | Pagey`;

  // Canonical URL + robots directive — published pages are indexable, drafts
  // are not (drafts are still publicly fetchable via GET /:slug, so this
  // matters: without it a draft could get indexed before the owner publishes).
  const isPublished = effectiveStatus === 'published';
  const pageUrl = canonicalUrl(
    { slug: page.slug as string, subdomain: (page as { subdomain?: string | null }).subdomain, sub_slug: (page as { sub_slug?: string | null }).sub_slug },
    parentSubdomain,
  );
  const robotsContent = isPublished ? 'index,follow' : 'noindex,nofollow';

  // JSON-LD (LocalBusiness + FAQPage) — only for published pages, built only from
  // real stored data (NO_FABRICATION_RULE). Server-side ONLY: the client no
  // longer emits structured data, so there is exactly one copy.
  const jsonLd = isPublished ? buildJsonLdScripts(page as unknown as SeoPage, pageUrl, firstImage) : '';

  const ogTags = `
    <title>${escapeHtml(title)}</title>
    <link rel="canonical" href="${escapeHtml(pageUrl)}" />
    <meta name="robots" content="${robotsContent}" />
    <meta property="og:title" content="${escapeHtml(page.business_name as string)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${escapeHtml(pageUrl)}" />
    ${firstImage ? `<meta property="og:image" content="${escapeHtml(firstImage)}" />` : ''}
    <meta property="og:locale" content="he_IL" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(page.business_name as string)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${firstImage ? `<meta name="twitter:image" content="${escapeHtml(firstImage)}" />` : ''}
    ${jsonLd}`;

  const shell = await loadHtmlShell();

  // The built shell (client/index.html) already carries Pagey's OWN generic
  // marketing OG/twitter tags + <meta name="description">, for when the
  // homepage itself is shared. Simply appending this page's tags before
  // </head> — the previous approach — left BOTH sets of tags in the HTML.
  // Most link-preview crawlers (WhatsApp's included) use the FIRST matching
  // tag when a property repeats, so the generic Pagey marketing caption won
  // every time a real page was shared, silently. Strip the generic ones
  // before injecting this page's real title/description/image so there is
  // exactly one of each and the page's own content always wins.
  const shellWithoutGenericTags = shell
    .replace(/<meta name="description"[^>]*>\s*/i, '')
    .replace(/<meta property="og:title"[^>]*>\s*/gi, '')
    .replace(/<meta property="og:description"[^>]*>\s*/gi, '')
    .replace(/<meta property="og:image"[^>]*>\s*/gi, '')
    .replace(/<meta property="og:url"[^>]*>\s*/gi, '')
    .replace(/<meta name="twitter:title"[^>]*>\s*/gi, '')
    .replace(/<meta name="twitter:description"[^>]*>\s*/gi, '')
    .replace(/<meta name="twitter:image"[^>]*>\s*/gi, '');

  // Replace the generic <title> and inject this page's own OG tags before </head>
  const withHead = shellWithoutGenericTags
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace('</head>', `${ogTags}\n  </head>`);

  // Published pages also get their real content (h1/h2/text/FAQ) inside #root so
  // crawlers see it without running JS; createRoot replaces it on load.
  const html = isPublished
    ? injectSeoBody(withHead, renderSeoBody(page as unknown as SeoPage))
    : withHead;

  res.status(200).setHeader('Content-Type', 'text/html').send(injectSubdomainSlug(html, res));
}

/**
 * GET /b/:subdomain and /b/:subdomain/:subSlug — the canonical, indexed URLs.
 * Resolves the page (a child via its parent's subdomain + sub_slug), exposes its
 * slug to the SPA, and reuses servePageWithOgTags for everything else. An unknown
 * path is a real 404 (status code) so crawlers drop it; the SPA still renders its
 * own not-found screen from the same shell.
 */
export async function serveBPage(req: Request, res: Response): Promise<void> {
  const found = await resolveBPage(req.params.subdomain, req.params.subSlug);
  if (!found) {
    const shell = await loadHtmlShell();
    res.status(404).setHeader('Content-Type', 'text/html').send(shell);
    return;
  }
  res.locals.pageSlug = found.slug;
  res.locals.bPath = true;
  await servePageWithOgTags(req, res);
}
