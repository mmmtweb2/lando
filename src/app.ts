import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { supabaseSession } from './utils/supabase/middleware';
import router from './routes';
import { servePageWithOgTags } from './controllers/og.controller';

const app = express();

app.use(cors({ credentials: true, origin: process.env.CORS_ORIGIN ?? true }));
app.use(express.json());
app.use(cookieParser());
app.use(supabaseSession);

// OG tag injection for public landing pages — must be before static middleware
// so crawlers (WhatsApp, Facebook) that hit /p/:slug get server-rendered meta tags
app.get('/p/:slug', servePageWithOgTags);

app.use(express.static(path.join(process.cwd(), 'public')));
app.use('/api', router);

// Global error handler — converts any unhandled throw into a JSON 500
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

export default app;
