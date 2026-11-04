import { supabase } from '../config/supabase';

// What a manual-premium customer sees in the guided setup: "בטיפול אצלנו" and the date by which the
// owner expects to finish filling the Google card. Read-only; the owner sets it in the admin tab.
// Before migration 045 the date column does not exist: the status still works, without a date.

export interface PremiumStatus { premium: boolean; expectedBy: string | null }

const NONE: PremiumStatus = { premium: false, expectedBy: null };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function getPremiumStatus(email: string): Promise<PremiumStatus> {
  let r = await supabase.from('seo_manual_premium').select('status, expected_by').eq('email', email).maybeSingle();
  if (r.error && /expected_by/.test(r.error.message)) {
    const base = await supabase.from('seo_manual_premium').select('status').eq('email', email).maybeSingle();
    r = base as typeof r;
  }
  if (r.error || !r.data) return NONE;   // no table, no row, or any error: treated as "not premium"
  const row = r.data as { status: string; expected_by?: string | null };
  if (row.status !== 'active') return NONE;
  return { premium: true, expectedBy: typeof row.expected_by === 'string' && DATE.test(row.expected_by) ? row.expected_by : null };
}
