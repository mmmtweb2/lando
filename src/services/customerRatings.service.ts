// Customers rate Pagey (decision 17.11, migration 052). A rating reaches the public site only when
// the customer ticked the consent box AND an admin approved it. Approval is by policy (a real
// customer, no abuse, no personal data), never by stars: every approved rating is shown, good or bad.
// We never edit a customer's words; the only actions on a rating are approve and reject.

import { supabase } from '../config/supabase';
import { BARE_DOMAIN } from './gbpPosts';

export type RatingProduct = 'pages' | 'seo';
export const PRODUCTS: readonly RatingProduct[] = ['pages', 'seo'];
export const MAX_TEXT = 400;
export const MAX_NAME = 40;
export const MAX_TYPE = 40;
/** The public block appears only once a product has this many approved, consented ratings. */
export const PUBLIC_MIN = 3;
export const PUBLIC_MAX_CARDS = 6;
/** A Google-promotion customer is asked after this many days with the product. */
export const SEO_ASK_AFTER_DAYS = 30;
export const CONSENT_TEXT = 'מסכימים שנציג את הדירוג באתר עם השם וסוג העסק';

export class RatingError extends Error {
  constructor(public code: 'invalid' | 'not_eligible' | 'not_found' | 'db', message: string) { super(message); }
}

export const isProduct = (x: unknown): x is RatingProduct => typeof x === 'string' && (PRODUCTS as readonly string[]).includes(x);

const LINK = /https?:\/\/|www\.|\S+@\S+\.\S+/i;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;

/**
 * Plain text only: control characters and angle brackets dropped, whitespace collapsed, length
 * capped. Text that carries a link, e-mail address or phone number is refused (not silently
 * rewritten), since we never change a customer's words.
 */
export function cleanField(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function hasContactDetails(s: string): boolean {
  return LINK.test(s) || BARE_DOMAIN.test(s) || PHONE.test(s);
}

export interface RatingInput { stars: number; text: string; displayName: string; businessType: string; consentPublish: boolean }

export function validateRating(body: Record<string, unknown>): { ok: true; value: RatingInput } | { ok: false; error: string } {
  const stars = Number(body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return { ok: false, error: 'בחרו דירוג בין 1 ל-5 כוכבים.' };
  const text = cleanField(body.text, MAX_TEXT);
  const displayName = cleanField(body.displayName, MAX_NAME);
  const businessType = cleanField(body.businessType, MAX_TYPE);
  const consentPublish = body.consentPublish === true;
  for (const v of [text, displayName, businessType]) {
    if (hasContactDetails(v)) return { ok: false, error: 'בלי קישורים, כתובות מייל או מספרי טלפון, בבקשה.' };
  }
  if (consentPublish && !displayName) return { ok: false, error: 'כדי שנציג את הדירוג באתר, כתבו איך להציג את השם.' };
  return { ok: true, value: { stars, text, displayName, businessType, consentPublish } };
}

export interface RatingRow {
  id: string; email: string; product: RatingProduct; stars: number; text: string; display_name: string; business_type: string;
  consent_publish: boolean; consent_text: string | null; status: 'pending' | 'approved' | 'rejected';
  created_at: string; updated_at: string; reviewed_at: string | null;
}

export interface PublicRating { stars: number; text: string; name: string; businessType: string; date: string }
export interface PublicSummary { product: RatingProduct; show: boolean; count: number; average: number | null; ratings: PublicRating[] }

/**
 * What the public may see. Count and average are over APPROVED ratings (consented or not, so the
 * average is not skewed toward people willing to be named); the cards are approved AND consented.
 * Below PUBLIC_MIN approved ratings nothing is shown at all.
 */
export function publicSummary(product: RatingProduct, rows: Pick<RatingRow, 'stars' | 'text' | 'display_name' | 'business_type' | 'consent_publish' | 'status' | 'created_at'>[]): PublicSummary {
  const approved = rows.filter((r) => r.status === 'approved');
  const count = approved.length;
  if (count < PUBLIC_MIN) return { product, show: false, count, average: null, ratings: [] };
  const average = Math.round((approved.reduce((s, r) => s + r.stars, 0) / count) * 10) / 10;
  const ratings = approved
    .filter((r) => r.consent_publish && r.display_name)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, PUBLIC_MAX_CARDS)
    .map((r) => ({ stars: r.stars, text: r.text, name: r.display_name, businessType: r.business_type, date: r.created_at.slice(0, 10) }));
  return { product, show: true, count, average, ratings };
}

/** Whether to ask now: eligible, not rated yet, not dismissed. Pure. */
export function shouldAsk(e: { eligible: boolean; askReady: boolean }, rated: boolean, dismissed: boolean): boolean {
  return e.eligible && e.askReady && !rated && !dismissed;
}

// ─── I/O ─────────────────────────────────────────────────────────────────────

const COLS = 'id, email, product, stars, text, display_name, business_type, consent_publish, consent_text, status, created_at, updated_at, reviewed_at';

export interface Eligibility { eligible: boolean; askReady: boolean }

/**
 * Only accounts that really used the product may rate it.
 *   pages: at least one page that was published (live now, or frozen after being live).
 *   seo:   any Google-promotion entitlement row, current or past; asked after SEO_ASK_AFTER_DAYS.
 */
export async function eligibility(email: string, now = new Date()): Promise<Record<RatingProduct, Eligibility>> {
  const [pages, seo] = await Promise.all([
    supabase.from('landing_pages').select('id').eq('owner_email', email).in('status', ['published', 'frozen']).limit(1),
    supabase.from('user_products').select('started_at, created_at').eq('email', email).eq('product', 'seo_autopilot').limit(1),
  ]);
  if (pages.error) throw new RatingError('db', pages.error.message);
  if (seo.error) throw new RatingError('db', seo.error.message);
  const hasPage = (pages.data ?? []).length > 0;
  const seoRow = (seo.data ?? [])[0] as { started_at?: string | null; created_at?: string | null } | undefined;
  const since = seoRow ? new Date(seoRow.started_at ?? seoRow.created_at ?? now.toISOString()).getTime() : NaN;
  return {
    pages: { eligible: hasPage, askReady: hasPage },
    seo: { eligible: Boolean(seoRow), askReady: Boolean(seoRow) && now.getTime() - since >= SEO_ASK_AFTER_DAYS * 86_400_000 },
  };
}

export interface MyRatings {
  products: Record<RatingProduct, { eligible: boolean; ask: boolean; rating: { stars: number; text: string; displayName: string; businessType: string; consentPublish: boolean; status: string } | null }>;
}

export async function getMine(email: string, now = new Date()): Promise<MyRatings> {
  const [elig, rows, prompts] = await Promise.all([
    eligibility(email, now),
    supabase.from('customer_ratings').select(COLS).eq('email', email),
    supabase.from('customer_rating_prompts').select('product').eq('email', email),
  ]);
  if (rows.error) throw new RatingError('db', rows.error.message);
  if (prompts.error) throw new RatingError('db', prompts.error.message);
  const mine = (rows.data ?? []) as RatingRow[];
  const dismissed = new Set(((prompts.data ?? []) as { product: string }[]).map((p) => p.product));
  const out = {} as MyRatings['products'];
  for (const p of PRODUCTS) {
    const r = mine.find((x) => x.product === p) ?? null;
    out[p] = {
      eligible: elig[p].eligible,
      ask: shouldAsk(elig[p], Boolean(r), dismissed.has(p)),
      rating: r ? { stars: r.stars, text: r.text, displayName: r.display_name, businessType: r.business_type, consentPublish: r.consent_publish, status: r.status } : null,
    };
  }
  return { products: out };
}

/** Creates or updates the account's rating of a product. Any change goes back to review. */
export async function saveMine(email: string, product: RatingProduct, v: RatingInput, now = new Date()): Promise<void> {
  const elig = await eligibility(email, now);
  if (!elig[product].eligible) throw new RatingError('not_eligible', 'אפשר לדרג אחרי שמשתמשים בשירות.');
  const { error } = await supabase.from('customer_ratings').upsert({
    email, product, stars: v.stars, text: v.text, display_name: v.displayName, business_type: v.businessType,
    consent_publish: v.consentPublish, consent_text: v.consentPublish ? CONSENT_TEXT : null,
    status: 'pending', reviewed_at: null, updated_at: now.toISOString(),
  }, { onConflict: 'email,product' });
  if (error) throw new RatingError('db', error.message);
  publicCache.clear();
}

/** "Not now": the dashboard stops asking about this product. */
export async function dismissAsk(email: string, product: RatingProduct, now = new Date()): Promise<void> {
  const { error } = await supabase.from('customer_rating_prompts').upsert({ email, product, dismissed_at: now.toISOString() }, { onConflict: 'email,product' });
  if (error) throw new RatingError('db', error.message);
}

export async function listForAdmin(): Promise<RatingRow[]> {
  const { data, error } = await supabase.from('customer_ratings').select(COLS).order('updated_at', { ascending: false }).limit(500);
  if (error) throw new RatingError('db', error.message);
  return (data ?? []) as RatingRow[];
}

export async function reviewRating(id: string, decision: 'approved' | 'rejected', now = new Date()): Promise<boolean> {
  const { data, error } = await supabase.from('customer_ratings').update({ status: decision, reviewed_at: now.toISOString() }).eq('id', id).select('id');
  if (error) throw new RatingError('db', error.message);
  publicCache.clear();
  return (data ?? []).length > 0;
}

const CACHE_MS = 5 * 60_000;
const publicCache = new Map<RatingProduct, { at: number; value: PublicSummary }>();

export async function publicRatings(product: RatingProduct, now = Date.now()): Promise<PublicSummary> {
  const hit = publicCache.get(product);
  if (hit && now - hit.at < CACHE_MS) return hit.value;
  const { data, error } = await supabase.from('customer_ratings')
    .select('stars, text, display_name, business_type, consent_publish, status, created_at')
    .eq('product', product).eq('status', 'approved').order('created_at', { ascending: false }).limit(500);
  if (error) throw new RatingError('db', error.message);
  const value = publicSummary(product, (data ?? []) as Parameters<typeof publicSummary>[1]);
  publicCache.set(product, { at: now, value });
  return value;
}

export function _clearRatingsCacheForTests(): void { publicCache.clear(); }
