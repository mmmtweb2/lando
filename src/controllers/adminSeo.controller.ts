// Admin tabs for the Google-promotion product (task #10). Admin-only (mounted behind the admin
// password, requireAuth and requireAdmin). Read-only except the manual-premium tracking row.
import type { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import {
  churn30, feedbackSignals, funnel, overview, parsePremium, premiumOnly, revenue, users,
  type EventR, type JourneyR, type PremiumR, type ProductR, type SubEventR, type SubR,
} from '../services/adminOps';
import { healthSnapshot } from '../services/adminHealth.service';

const missing = (m?: string) => /does not exist|schema cache|42P01|PGRST205/i.test(m ?? '');
const JCOLS = 'email, stage, source, utm_source, registered_at, setup_at, ready_at, activation_requested_at, beta_activated_at, updated_at';
const EVENT_WINDOW_DAYS = 120;

class LoadError extends Error { constructor(public readonly table: string, m: string) { super(m); } }
async function rows<T>(table: string, q: PromiseLike<{ data: unknown; error: { message: string } | null }>, optional = false): Promise<T[]> {
  const { data, error } = await q;
  if (error) { if (optional && missing(error.message)) return []; throw new LoadError(table, error.message); }
  return (data ?? []) as T[];
}
const journeys = () => rows<JourneyR>('seo_journey', supabase.from('seo_journey').select(JCOLS).limit(5000));
const products = () => rows<ProductR>('user_products', supabase.from('user_products').select('email, status, current_period_end, source').eq('product', 'seo_autopilot').limit(5000));
const subs = () => rows<SubR>('seo_subscriptions', supabase.from('seo_subscriptions').select('email, status, amount, created_at, cancel_at_period_end, needs_manual_cancel').limit(5000), true);
const premiumRows = () => rows<PremiumR>('seo_manual_premium', supabase.from('seo_manual_premium').select('email, status, last_card_update, monthly_price, note').limit(5000), true);
const events = () => rows<EventR>('journey_events', supabase.from('journey_events')
  .select('event, email, anon_id, props, created_at').gte('created_at', new Date(Date.now() - EVENT_WINDOW_DAYS * 86400000).toISOString())
  .order('created_at', { ascending: false }).limit(20000), true);

function fail(res: Response, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof LoadError && missing(e.message)) { res.status(503).json({ error: 'חסרה מיגרציה במסד הנתונים.', code: 'not_migrated', table: e.table }); return; }
  console.error('[ADMIN-SEO] failed:', msg.slice(0, 200));
  res.status(500).json({ error: 'שגיאה בטעינת הנתונים.' });
}

export async function adminSeoOverview(_req: Request, res: Response): Promise<void> {
  try {
    const now = new Date();
    const [j, p, s, pr, health] = await Promise.all([journeys(), products(), subs(), premiumRows(), healthSnapshot(now)]);
    res.json(overview({ journeys: j, products: p, subs: s, premium: pr, alerts: health.alerts, now }));
  } catch (e) { fail(res, e); }
}

export async function adminSeoFunnel(_req: Request, res: Response): Promise<void> {
  try {
    const now = new Date();
    const [j, p, ev] = await Promise.all([journeys(), products(), events()]);
    res.json(funnel(j, ev, p, now));
  } catch (e) { fail(res, e); }
}

export async function adminSeoUsers(_req: Request, res: Response): Promise<void> {
  try {
    const now = new Date();
    const [j, p, pr] = await Promise.all([journeys(), products(), premiumRows()]);
    res.json({ users: users(j, p, pr, now), premiumWithoutJourney: premiumOnly(j, pr) });
  } catch (e) { fail(res, e); }
}

export async function adminSeoRevenue(_req: Request, res: Response): Promise<void> {
  try {
    const now = new Date();
    const [j, p, s, pr] = await Promise.all([journeys(), products(), subs(), premiumRows()]);
    const base = revenue({ journeys: j, products: p, subs: s, premium: pr, now });
    const subEvents = await rows<SubEventR>('seo_subscription_events', supabase.from('seo_subscription_events').select('kind, created_at').eq('kind', 'canceled').limit(5000), true);
    res.json({ ...base, churn30: churn30(subEvents, base.payingCustomers, now) });
  } catch (e) { fail(res, e); }
}

export async function adminSeoHealth(_req: Request, res: Response): Promise<void> {
  try { res.json(await healthSnapshot()); } catch (e) { fail(res, e); }
}

export async function adminSeoFeedback(_req: Request, res: Response): Promise<void> {
  try { res.json(feedbackSignals(await events(), new Date())); } catch (e) { fail(res, e); }
}

/** Create or update the manual-premium tracking row of one account. Tracking only: nothing is sent to Google or SUMIT. */
export async function adminSetManualPremium(req: Request, res: Response): Promise<void> {
  const p = parsePremium(req.body);
  if (!p.ok) { res.status(400).json({ error: p.error }); return; }
  const v = p.value;
  const { data: acct, error: aErr } = await supabase.from('user_profiles').select('email').eq('email', v.email).maybeSingle();
  if (aErr) { fail(res, new LoadError('user_profiles', aErr.message)); return; }
  if (!acct) { res.status(404).json({ error: 'אין חשבון עם המייל הזה.' }); return; }
  const { error } = await supabase.from('seo_manual_premium').upsert({
    email: v.email, status: v.status, last_card_update: v.lastCardUpdate, monthly_price: v.monthlyPrice, note: v.note, updated_at: new Date().toISOString(),
  }, { onConflict: 'email' });
  if (error) { fail(res, new LoadError('seo_manual_premium', error.message)); return; }
  res.json({ ok: true });
}
