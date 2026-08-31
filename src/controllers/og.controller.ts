import { Request, Response } from 'express';
import { readFile } from 'fs/promises';
import path from 'path';
import { supabase } from '../config/supabase';
import { getPlanStatus } from '../services/plan.service';

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

export async function servePageWithOgTags(req: Request, res: Response): Promise<void> {
  const { slug } = req.params;

  const { data: page, error } = await supabase
    .from('landing_pages')
    .select('business_name, ai_content, user_images, logo_url, owner_email, status, slug, address, phone_number')
    .eq('slug', slug)
    .single();

  if (error || !page) {
    // Not found — let the SPA handle the 404 UI
    const shell = await loadHtmlShell();
    res.status(200).setHeader('Content-Type', 'text/html').send(shell);
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
      whiteLabel = (await getPlanStatus(page.owner_email as string)).whiteLabel;
    } catch (e) {
      console.error('servePageWithOgTags: failed to resolve whiteLabel status', e);
    }
  }
  const title = whiteLabel ? `${page.business_name}` : `${page.business_name} | Pagey`;

  // Canonical URL + robots directive — published pages are indexable, drafts
  // are not (drafts are still publicly fetchable via GET /:slug, so this
  // matters: without it a draft could get indexed before the owner publishes).
  const isPublished = page.status === 'published';
  const pageUrl = `${SITE_URL}/p/${page.slug as string}`;
  const robotsContent = isPublished ? 'index,follow' : 'noindex,nofollow';

  // JSON-LD LocalBusiness structured data — only for published pages (drafts
  // shouldn't get indexable structured data), built only from real stored
  // data. Never fabricate a missing field (NO_FABRICATION_RULE product
  // principle) — omit phone/address/image entirely when not on file.
  let jsonLd = '';
  if (isPublished) {
    const localBusiness: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: page.business_name,
      url: pageUrl,
    };
    if (page.phone_number) localBusiness.telephone = page.phone_number;
    if (page.address) {
      localBusiness.address = { '@type': 'PostalAddress', streetAddress: page.address };
    }
    if (firstImage) localBusiness.image = firstImage;
    jsonLd = `<script type="application/ld+json">${JSON.stringify(localBusiness).replace(/</g, '\\u003c')}</script>`;
  }

  const ogTags = `
    <title>${escapeHtml(title)}</title>
    <link rel="canonical" href="${escapeHtml(pageUrl)}" />
    <meta name="robots" content="${robotsContent}" />
    <meta property="og:title" content="${escapeHtml(page.business_name as string)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    ${firstImage ? `<meta property="og:image" content="${escapeHtml(firstImage)}" />` : ''}
    <meta property="og:locale" content="he_IL" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(page.business_name as string)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${firstImage ? `<meta name="twitter:image" content="${escapeHtml(firstImage)}" />` : ''}
    ${jsonLd}`;

  const shell = await loadHtmlShell();

  // Replace the generic <title> and inject OG tags before </head>
  const html = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace('</head>', `${ogTags}\n  </head>`);

  res.status(200).setHeader('Content-Type', 'text/html').send(html);
}
