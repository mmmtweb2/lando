import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { supabaseSession } from './utils/supabase/middleware';
import router from './routes';
import { servePageWithOgTags } from './controllers/og.controller';

const app = express();

// Behind a proxy/load-balancer in production, trust the first hop so `req.ip`
// (used by the rate limiter) reflects the real client, not the proxy.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// In production, CORS_ORIGIN MUST be set to the real front-end origin. Falling
// back to "allow all" is only acceptable for local development.
const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin && process.env.NODE_ENV === 'production') {
  console.warn('[cors] CORS_ORIGIN is not set in production — refusing to allow all origins. Set CORS_ORIGIN to your front-end URL.');
}
app.use(cors({ credentials: true, origin: corsOrigin ?? true }));
app.use(express.json());
app.use(cookieParser());
app.use(supabaseSession);

// OG tag injection for public landing pages — must be before static middleware
// so crawlers (WhatsApp, Facebook) that hit /p/:slug get server-rendered meta tags
app.get('/p/:slug', servePageWithOgTags);

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
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

export default app;
