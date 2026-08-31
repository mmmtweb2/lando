import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase';

// Augment Express.Request with the verified identity we attach below.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authEmail?: string;
      isAdmin?: boolean;
    }
  }
}

function extractBearer(req: Request): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * Verifies the Supabase access token sent in `Authorization: Bearer <token>`.
 * On success attaches `req.authEmail` (lowercased). Rejects with 401 otherwise.
 *
 * This is the real identity check: the token is validated against Supabase, so
 * unlike an email in the request body it cannot be spoofed by the caller.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({ error: 'נדרשת התחברות.' });
    return;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) {
    res.status(401).json({ error: 'ההתחברות פגה. התחברו מחדש.' });
    return;
  }
  req.authEmail = data.user.email.toLowerCase();
  next();
}

/**
 * Like requireAuth, but never rejects: if a valid bearer token is present it
 * attaches req.authEmail, otherwise it just calls next() with no identity set.
 * Use this on PUBLIC routes that want to know "is the caller logged in as X"
 * (e.g. to compute an isOwner flag) without requiring login to view the page.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractBearer(req);
  if (token) {
    const { data, error } = await supabase.auth.getUser(token);
    if (!error && data.user?.email) {
      req.authEmail = data.user.email.toLowerCase();
    }
  }
  next();
}

/**
 * Requires the authenticated user to be an admin (user_profiles.is_admin = true).
 * Must run after requireAuth.
 */
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.authEmail) {
    res.status(401).json({ error: 'נדרשת התחברות.' });
    return;
  }
  const { data } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('email', req.authEmail)
    .single();
  if (!data?.is_admin) {
    res.status(403).json({ error: 'גישת מנהל בלבד.' });
    return;
  }
  req.isAdmin = true;
  next();
}

/**
 * Requires the authenticated user to OWN the landing page referenced by :id
 * (or to be an admin). Must run after requireAuth. Returns 404 if the page does
 * not exist, 403 if the caller is neither the owner nor an admin.
 */
export async function requireOwnPage(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.authEmail) {
    res.status(401).json({ error: 'נדרשת התחברות.' });
    return;
  }
  const { id } = req.params;
  const { data: page, error } = await supabase
    .from('landing_pages')
    .select('owner_email')
    .eq('id', id)
    .single();

  if (error || !page) {
    res.status(404).json({ error: 'הדף לא נמצא.' });
    return;
  }

  const owner = ((page as { owner_email?: string | null }).owner_email ?? '').toLowerCase();
  if (owner && owner === req.authEmail) {
    next();
    return;
  }

  // Fall back to admin override.
  const { data: prof } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('email', req.authEmail)
    .single();
  if (prof?.is_admin) {
    req.isAdmin = true;
    next();
    return;
  }

  res.status(403).json({ error: 'אין לך הרשאה לפעול על דף זה.' });
}
