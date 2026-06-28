import { Request, Response, NextFunction } from 'express';
import { createClient } from './server';

// Refreshes the Supabase session on every request so auth tokens stay current.
// Never throws — a failed refresh is non-fatal for public routes.
export async function supabaseSession(req: Request, res: Response, next: NextFunction) {
  try {
    const supabase = createClient(req, res);
    await supabase.auth.getUser();
  } catch {
    // intentionally swallowed — session refresh failure must not block requests
  }
  next();
}
