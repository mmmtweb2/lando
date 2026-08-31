import { Request, Response } from 'express';
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
  const { data: pages, error } = await supabase
    .from('landing_pages')
    .select('slug, published_at, created_at')
    .eq('status', 'published');

  if (error) {
    console.error('serveSitemap: failed to load published pages', error);
  }

  const urls: string[] = [
    `  <url>\n    <loc>${SITE_URL}/</loc>\n    <changefreq>weekly</changefreq>\n    <priority>1.0</priority>\n  </url>`,
  ];

  for (const page of pages ?? []) {
    const lastmodRaw = (page as { published_at?: string; created_at?: string }).published_at
      ?? (page as { created_at?: string }).created_at;
    const lastmod = lastmodRaw ? new Date(lastmodRaw).toISOString().slice(0, 10) : undefined;
    urls.push(
      `  <url>\n    <loc>${SITE_URL}/p/${escapeXml(page.slug as string)}</loc>${
        lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''
      }\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>`
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;

  res.status(200).setHeader('Content-Type', 'application/xml').send(xml);
}
