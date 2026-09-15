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

interface SiteVisitRow {
  path: string;
  referrer: string | null;
  utm_source: string | null;
  visitor_id: string;
  created_at: string;
}

/**
 * Marketing-site traffic overview (site_visits — see
 * migrations/021_site_visits.sql). Same computed-in-Node approach as
 * getRevenueStats above, at the same volume tier — no SQL views/RPCs needed
 * yet. Only the last 90 days are pulled to keep this cheap as the table
 * grows; the dashboard only ever shows a 30-day view anyway.
 */
export async function getSiteTraffic(_req: Request, res: Response): Promise<void> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('site_visits')
    .select('path, referrer, utm_source, visitor_id, created_at')
    .gte('created_at', ninetyDaysAgo)
    .order('created_at', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }

  const rows = (data ?? []) as SiteVisitRow[];

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  let viewsToday = 0;
  let viewsLast7Days = 0;
  let viewsLast30Days = 0;
  const uniqueVisitors30d = new Set<string>();
  const byDay = new Map<string, { views: number; visitors: Set<string> }>();
  const bySource = new Map<string, number>();
  const byPath = new Map<string, number>();

  for (const r of rows) {
    const created = new Date(r.created_at);
    if (created < thirtyDaysAgo) continue; // stats below are all 30-day-scoped

    viewsLast30Days += 1;
    uniqueVisitors30d.add(r.visitor_id);
    if (created >= startOfDay) viewsToday += 1;
    if (created >= sevenDaysAgo) viewsLast7Days += 1;

    const dayKey = created.toISOString().slice(0, 10);
    const d = byDay.get(dayKey) ?? { views: 0, visitors: new Set<string>() };
    d.views += 1;
    d.visitors.add(r.visitor_id);
    byDay.set(dayKey, d);

    // Source = utm_source if present, else the referrer's hostname, else "ישיר" (direct).
    let source = r.utm_source?.trim() || null;
    if (!source && r.referrer) {
      try { source = new URL(r.referrer).hostname.replace(/^www\./, ''); } catch { source = null; }
    }
    source = source || 'ישיר';
    bySource.set(source, (bySource.get(source) ?? 0) + 1);

    byPath.set(r.path, (byPath.get(r.path) ?? 0) + 1);
  }

  const dailyBreakdown = Array.from(byDay.entries())
    .map(([day, v]) => ({ day, views: v.views, uniqueVisitors: v.visitors.size }))
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 30);

  const bySourceArr = Array.from(bySource.entries())
    .map(([source, views]) => ({ source, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  const topPaths = Array.from(byPath.entries())
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  res.json({
    viewsToday,
    viewsLast7Days,
    viewsLast30Days,
    uniqueVisitorsLast30Days: uniqueVisitors30d.size,
    dailyBreakdown,
    bySource: bySourceArr,
    topPaths,
  });
}
