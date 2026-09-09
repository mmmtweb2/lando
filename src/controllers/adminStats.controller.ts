import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Admin dashboard: customer list + revenue overview.
//
// Both are read-only, admin-gated (requireAuth + requireAdmin, same as every
// other /api/admin/* route), and deliberately computed in Node rather than
// with SQL aggregation — payment/user volume here is small enough that a
// straight SELECT + in-memory reduce is simpler and safer than adding new
// SQL views or RPC functions for a first version of this screen.
// ─────────────────────────────────────────────────────────────────────────────

interface UserProfileRow {
  email: string;
  created_at: string;
  plan: string;
  plan_expires_at: string | null;
  credits: number;
  page_credits: number;
  page_credits_total: number;
  white_label: boolean;
  is_admin: boolean | null;
}

/**
 * All registered users (user_profiles), each annotated with how many landing
 * pages they've created and how many are currently published — the two
 * numbers an admin actually wants when scanning a customer list, not just the
 * wallet balance.
 */
export async function listUsers(_req: Request, res: Response): Promise<void> {
  const { data: profiles, error } = await supabase
    .from('user_profiles')
    .select('email, created_at, plan, plan_expires_at, credits, page_credits, page_credits_total, white_label, is_admin')
    .order('created_at', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }

  // One extra query for page counts per owner rather than N+1 lookups.
  const { data: pages, error: pagesError } = await supabase
    .from('landing_pages')
    .select('owner_email, status');

  if (pagesError) { res.status(500).json({ error: pagesError.message }); return; }

  const counts = new Map<string, { total: number; published: number }>();
  for (const row of (pages ?? []) as { owner_email: string | null; status: string }[]) {
    if (!row.owner_email) continue;
    const entry = counts.get(row.owner_email) ?? { total: 0, published: 0 };
    entry.total += 1;
    if (row.status === 'published') entry.published += 1;
    counts.set(row.owner_email, entry);
  }

  const result = ((profiles ?? []) as UserProfileRow[]).map((u) => {
    const c = counts.get(u.email) ?? { total: 0, published: 0 };
    return { ...u, pages_total: c.total, pages_published: c.published };
  });

  res.json(result);
}

interface PaymentRevenueRow {
  amount: number;
  purpose: string;
  created_at: string;
}

/**
 * Revenue overview computed from `payments` rows with status='paid' — the
 * only rows that represent money actually collected (pending/failed/
 * needs_review carry no revenue). Returns total, this-month, trailing-30-day,
 * a monthly breakdown (last 12 months with any revenue), and a breakdown by
 * purpose (publish/renew/credits/bundle) so an admin can see what's actually
 * selling.
 */
export async function getRevenueStats(_req: Request, res: Response): Promise<void> {
  const { data, error } = await supabase
    .from('payments')
    .select('amount, purpose, created_at')
    .eq('status', 'paid')
    .order('created_at', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }

  const rows = (data ?? []) as PaymentRevenueRow[];

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  let totalRevenue = 0;
  let thisMonthRevenue = 0;
  let last30DaysRevenue = 0;
  const byMonth = new Map<string, { revenue: number; count: number }>();
  const byPurpose = new Map<string, { revenue: number; count: number }>();

  for (const r of rows) {
    const amount = Number(r.amount) || 0;
    const created = new Date(r.created_at);

    totalRevenue += amount;
    if (created >= startOfMonth) thisMonthRevenue += amount;
    if (created >= thirtyDaysAgo) last30DaysRevenue += amount;

    const monthKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
    const m = byMonth.get(monthKey) ?? { revenue: 0, count: 0 };
    m.revenue += amount;
    m.count += 1;
    byMonth.set(monthKey, m);

    const p = byPurpose.get(r.purpose) ?? { revenue: 0, count: 0 };
    p.revenue += amount;
    p.count += 1;
    byPurpose.set(r.purpose, p);
  }

  const monthlyBreakdown = Array.from(byMonth.entries())
    .map(([month, v]) => ({ month, revenue: v.revenue, count: v.count }))
    .sort((a, b) => b.month.localeCompare(a.month))
    .slice(0, 12);

  const byPurposeArr = Array.from(byPurpose.entries())
    .map(([purpose, v]) => ({ purpose, revenue: v.revenue, count: v.count }))
    .sort((a, b) => b.revenue - a.revenue);

  res.json({
    totalRevenue,
    thisMonthRevenue,
    last30DaysRevenue,
    paidPaymentsCount: rows.length,
    monthlyBreakdown,
    byPurpose: byPurposeArr,
  });
}
