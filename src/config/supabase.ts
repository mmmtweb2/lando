import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

// Server-side client. Prefer the SERVICE-ROLE key so backend operations bypass
// RLS (credit gate, deductions, referral, profile creation read/write).
// ⚠️ NEVER expose the service-role key to the browser — server-side use only.
// Falls back to the publishable key if the service-role key isn't set yet.
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and a Supabase key (SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) must be set');
}

// Diagnostic: decode the JWT's `role` claim (NOT secret) so we can confirm
// whether the backend is actually using the service_role key (bypasses RLS)
// or accidentally the anon key (subject to RLS).
function decodeKeyRole(jwt: string): string {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64').toString()).role ?? 'unknown';
  } catch {
    return 'unparseable';
  }
}
console.log(
  '[supabase] backend key role =', decodeKeyRole(supabaseKey),
  '| SUPABASE_SERVICE_ROLE_KEY present =', !!process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
