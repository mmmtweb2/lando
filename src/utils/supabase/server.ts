import { createServerClient } from '@supabase/ssr';
import { Request, Response } from 'express';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set');
}

// Creates a per-request Supabase client that reads/writes cookies via Express req/res.
export const createClient = (req: Request, res: Response) =>
  createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return Object.entries(req.cookies ?? {}).map(([name, value]) => ({
          name,
          value: value as string,
        }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          res.cookie(name, value, options as Record<string, unknown>),
        );
      },
    },
  });
