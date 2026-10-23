import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { supabaseSession } from './utils/supabase/middleware';
import router from './routes';
import { servePageWithOgTags, serveBPage } from './controllers/og.controller';
import { rateLimit } from './middleware/rateLimit';
import { serveSitemap } from './controllers/sitemap.controller';
import { serveReviewsWidget } from './controllers/reviewsWidget.controller';
import { serveTrackScript } from './controllers/seoTrack.controller';
import { ROOT_DOMAIN, subdomainFromHost, getPageBySubdomain } from './services/subdomain.service';

const app = express();

// Behind a proxy/load-balancer in production, trust the first hop so `req.ip`
// (used by the rate limiter) reflects the real client, not the proxy.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// In production, CORS_ORIGIN MUST be set to the real front-end origin. Falling
// back to "allow all" is only acceptable for local development — in
// production, an unset CORS_ORIGIN must fail CLOSED (reject cross-origin
// requests), not open (reflect any origin with credentials enabled), since
// `origin: true` + `credentials: true` would otherwise silently accept
// credentialed requests from any site if this env var is ever missing.
const corsOrigin = process.env.CORS_ORIGIN;
const isProd = process.env.NODE_ENV === 'production';
if (!corsOrigin && isProd) {
  console.warn('[cors] CORS_ORIGIN is not set in production — refusing to allow all origins. Set CORS_ORIGIN to your front-end URL.');
}
app.use(cors({ credentials: true, origin: corsOrigin ?? (isProd ? false : true) }));
app.use(express.json());
app.use(cookieParser());
app.use(supabaseSession);

// OG tag injection for public landing pages — must be before static middleware
// so crawlers (WhatsApp, Facebook) that hit /p/:slug get server-rendered meta tags.
// Rate-limited like the other public read endpoints (landing.routes.ts's
// pageViewLimiter) — generous, since real page views (and crawler hits) can be
// bursty, but not unlimited: this does real DB work on every hit.
const ogPageLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: 'יותר מדי בקשות בזמן קצר. נסו שוב בעוד רגע.',
});
// Customer subdomains (cafe-dani.pagey.co.il). Cloudflare proxies the wildcard
// record, so the TCP peer is Cloudflare — restore the real visitor IP from
// CF-Connecting-IP (scoped to subdomain hosts only, so the apex's IP handling is
// untouched). Only GET / is intercepted: assets, /api/* and every other path
// fall through to the normal static/API/SPA handlers on the same host.
app.use(async (req: Request, res: Response, next: NextFunction) => {
  const sub = subdomainFromHost(req.hostname);
  if (!sub) { next(); return; }

  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp) {
    Object.defineProperty(req, 'ip', { value: cfIp, configurable: true });
  }

  if (req.method !== 'GET' || req.path !== '/') { next(); return; }

  ogPageLimiter(req, res, async () => {
    try {
      const page = await getPageBySubdomain(sub);
      if (!page) { res.redirect(302, `https://${ROOT_DOMAIN}/`); return; }
      res.locals.pageSlug = page.slug;
      res.locals.bySubdomain = sub;
      await servePageWithOgTags(req, res);
    } catch (err) {
      next(err);
    }
  });
});
app.get('/p/:slug', ogPageLimiter, servePageWithOgTags);
// Embeddable Google-reviews widget (Stage 6.2). Public + iframe-able; cost guards live in the
// controller (per-business and total daily caps), this is the per-IP burst limit.
const reviewsWidgetLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: 'יותר מדי בקשות. נסו שוב בעוד דקה.',
});
app.get('/w/reviews/:businessId', reviewsWidgetLimiter, serveReviewsWidget);
app.get('/w/track.js', serveTrackScript);
app.get('/b/:subdomain', ogPageLimiter, serveBPage);
app.get('/b/:subdomain/:subSlug', ogPageLimiter, serveBPage);

// Generated sitemap — real published pages, not the old static homepage-only
// file. Must be registered before static middleware so it isn't shadowed by
// client/dist/sitemap.xml (copied from client/public at build time).
app.get('/sitemap.xml', serveSitemap);

// Serve the built React client (produced by `vite build` → client/dist).
const clientDist = path.join(process.cwd(), 'client', 'dist');
app.use(express.static(clientDist));
// Legacy/static assets (e.g. uploaded files) still served from /public.
app.use(express.static(path.join(process.cwd(), 'public')));
app.use('/api', router);

// SPA fallback — any non-API, non-/p route returns the client index.html, so
// client-side routes (/dashboard, /create, /login) work on direct load & refresh.
// /p/:slug and /api/* are registered above and won't reach here.
app.get('*', (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith('/api')) { next(); return; }
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Global error handler — converts any unhandled throw into a JSON 500
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  // 2026-09-14 pre-launch audit: was returning err.message straight to the
  // client — a raw Postgres/Supabase driver error can include table/column/
  // constraint names, handing an attacker free reconnaissance on any
  // unexpected 500. Log the real error server-side (above); the client only
  // ever gets a generic message.
  res.status(500).json({ error: 'שגיאה בשרת. נסו שוב, ואם זה נמשך צרו איתנו קשר.' });
});

export default app;
