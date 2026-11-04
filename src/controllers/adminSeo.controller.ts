// Admin tabs for the Google-promotion product (task #10). Admin-only (mounted behind the admin
// password, requireAuth and requireAdmin). Read-only except the manual-premium tracking row.
import type { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import {
  churn30, feedbackSignals, funnel, overview, parsePremium, premiumOnly, revenue, users,
  type AuditContactR, type BusinessNameR, type EventR, type JourneyR, type PremiumR, type ProductR, type SubEventR, type SubR,
} from '../services/adminOps';
import { healthSnapshot } from '../services/adminHealth.service';
import { allowRun, runDiagnosis } from '../services/gbpDiagnose.service';

const missing = (m?: string) => /does not exist|schema cache|42P01|PGRST205/i.test(m ?? '');
const JCOLS_BASE = 'email, place_id, stage, source, utm_source, registered_at, setup_at, ready_at, activation_requested_at, beta_activated_at, updated_at';
const JCOLS = `${JCOLS_BASE}, profile_state, pending_name`;
const EVENT_WINDOW_DAYS = 120;

class LoadError extends Error { constructor(public readonly table: string, m: string) { super(m); } }
async function rows<T>(table: string, q: PromiseLike<{ data: unknown; error: { message: string } | null }>, optional = false): Promise<T[]> {
  const { data, error } = await q;
  if (error) { if (optional && missing(error.message)) return []; throw new LoadError(table, error.message); }
  return (data ?? []) as T[];
}
// Before migration 041 the two profile columns do not exist: fall back so the admin tabs keep loading.
async function journeys(): Promise<JourneyR[]> {
  const first = await supabase.from('seo_journey').select(JCOLS).limit(5000);
  if (first.error && /profile_state|pending_name/.test(first.error.message)) return rows<JourneyR>('seo_journey', supabase.from('seo_journey').select(JCOLS_BASE).limit(5000));
  return rows<JourneyR>('seo_journey', Promise.resolve(first));
}
const products = () => rows<ProductR>('user_products', supabase.from('user_products').select('email, status, current_period_end, source').eq('product', 'seo_autopilot').limit(5000));
const subs = () => rows<SubR>('seo_subscriptions', supabase.from('seo_subscriptions').select('email, status, amount, created_at, cancel_at_period_end, needs_manual_cancel').limit(5000), true);
// Before migration 045 the expected_by column does not exist: fall back so the tabs keep loading.
async function premiumRows(): Promise<PremiumR[]> {
  const first = await supabase.from('seo_manual_premium').select('email, status, last_card_update, monthly_price, note, expected_by').limit(5000);
  if (first.error && /expected_by/.test(first.error.message)) return rows<PremiumR>('seo_manual_premium', supabase.from('seo_manual_premium').select('email, status, last_card_update, monthly_price, note').limit(5000), true);
  return rows<PremiumR>('seo_manual_premium', Promise.resolve(first), true);
}
const events = () => rows<EventR>('journey_events', supabase.from('journey_events')
  .select('event, email, anon_id, props, created_at').gte('created_at', new Date(Date.now() - EVENT_WINDOW_DAYS * 86400000).toISOString())
  .order('created_at', { ascending: false }).limit(20000), true);

const businessNames = () => rows<BusinessNameR>('seo_businesses', supabase.from('seo_businesses').select('owner_email, name').limit(5000), true);
const auditContacts = () => rows<AuditContactR>('audit_leads', supabase.from('audit_leads').select('place_id, name, phone, business_name, created_at').order('created_at', { ascending: false }).limit(2000), true);
/** Public-Audit leads of the last 30 days not marked handled (migration 042). null = cannot tell (table or column missing). */
async function unhandledAuditLeads(now: Date): Promise<number | null> {
  const since = new Date(now.getTime() - 30 * 86400000).toISOString();
  const { count, error } = await supabase.from('audit_leads').select('id', { count: 'exact', head: true }).is('handled_at', null).gte('created_at', since);
  return error ? null : count ?? 0;
}

function fail(res: Response, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof LoadError && missing(e.message)) { res.status(503).json({ error: 'חסרה מיגרציה במסד הנתונים.', code: 'not_migrated', table: e.table }); return; }
  console.error('[ADMIN-SEO] failed:', msg.slice(0, 200));
  res.status(500).json({ error: 'שגיאה בטעינת הנתונים.' });
}

export async function adminSeoOverview(_req: Request, res: Response): Promise<void> {
  try {
    const now = new Date();
    const [j, p, s, pr, health, leads] = await Promise.all([journeys(), products(), subs(), premiumRows(), healthSnapshot(now), unhandledAuditLeads(now)]);
    res.json(overview({ journeys: j, products: p, subs: s, premium: pr, alerts: health.alerts, now, auditLeadsUnhandled: leads }));
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
    const [j, p, pr, biz, contacts] = await Promise.all([journeys(), products(), premiumRows(), businessNames(), auditContacts()]);
    res.json({ users: users(j, p, pr, now, { businesses: biz, contacts }), premiumWithoutJourney: premiumOnly(j, pr) });
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
  const row = { email: v.email, status: v.status, last_card_update: v.lastCardUpdate, monthly_price: v.monthlyPrice, note: v.note, updated_at: new Date().toISOString() };
  let { error } = await supabase.from('seo_manual_premium').upsert({ ...row, expected_by: v.expectedBy }, { onConflict: 'email' });
  if (error && /expected_by/.test(error.message)) {
    if (v.expectedBy) { res.status(503).json({ error: 'התאריך הצפוי יישמר אחרי שתרוץ מיגרציה 045.', code: 'not_migrated' }); return; }
    ({ error } = await supabase.from('seo_manual_premium').upsert(row, { onConflict: 'email' }));
  }
  if (error) { fail(res, new LoadError('seo_manual_premium', error.message)); return; }
  res.json({ ok: true });
}

/** Read-only diagnosis of a Google Business Profile connection (default: the admin's own). Spends a few API calls. */
export async function adminGbpDiagnose(req: Request, res: Response): Promise<void> {
  const raw = (req.body as { email?: unknown } | undefined)?.email;
  const email = (typeof raw === 'string' && raw.trim() ? raw.trim().toLowerCase() : req.authEmail ?? '').slice(0, 254);
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email)) { res.status(400).json({ error: 'מייל לא תקין.' }); return; }
  if (!allowRun()) { res.status(429).json({ error: 'אבחון רץ לפני רגע. חכו 10 שניות.' }); return; }
  try { res.json(await runDiagnosis(email)); } catch (e) { fail(res, e); }
}
