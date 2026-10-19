import { Request, Response } from 'express';
import { canonicalUrl } from '../services/subdomain.service';
import { supabase } from '../config/supabase';

const SITE_URL = 'https://pagey.co.il';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// GET /sitemap.xml — generated from real published pages, so it stays in
// sync automatically instead of the old static file that only ever listed
// the homepage.
export async function serveSitemap(_req: Request, res: Response): Promise<void> {
  // Parents: published, non-child pages. Children: rows whose parent is one of
  // those (a child inherits status/expiry from its parent, so a child of a
  // non-published parent is never listed).
  const { data: pages, error } = await supabase
    .from('landing_pages')
    .select('id, slug, subdomain, published_at, created_at')
    .eq('status', 'published')
    .is('parent_id', null);

  if (error) {
    console.error('serveSitemap: failed to load published pages', error);
  }

  const urls: string[] = [
    `  <url>\n    <loc>${SITE_URL}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
  ];

  const entry = (loc: string, lastmodRaw: string | null | undefined, priority: string): string => {
    const lastmod = lastmodRaw ? new Date(lastmodRaw).toISOString().slice(0, 10) : undefined;
    return `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
  };

  const parents = (pages ?? []) as { id: string; slug: string; subdomain: string | null; published_at: string | null; created_at: string | null }[];
  for (const page of parents) {
    urls.push(entry(canonicalUrl({ slug: page.slug, subdomain: page.subdomain }), page.published_at ?? page.created_at, '0.8'));
  }

  const parentIds = parents.filter((p) => p.subdomain).map((p) => p.id);
  if (parentIds.length > 0) {
    const { data: children, error: childErr } = await supabase
      .from('landing_pages')
      .select('parent_id, sub_slug, published_at, created_at')
      .in('parent_id', parentIds);
    if (childErr) console.error('serveSitemap: failed to load child pages', childErr);
    const byId = new Map(parents.map((p) => [p.id, p]));
    for (const child of (children ?? []) as { parent_id: string; sub_slug: string | null; published_at: string | null; created_at: string | null }[]) {
      const parent = byId.get(child.parent_id);
      if (!parent || !child.sub_slug) continue;
      urls.push(entry(canonicalUrl({ slug: '', sub_slug: child.sub_slug }, parent.subdomain), child.published_at ?? child.created_at, '0.7'));
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

  res.status(200).setHeader('Content-Type', 'application/xml').send(xml);
}
