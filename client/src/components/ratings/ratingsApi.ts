// Customer ratings (migration 052): shapes + calls. Server: src/controllers/ratings.controller.ts.
import { authFetch } from '../../lib/api';

export type RatingProduct = 'pages' | 'seo';
export const PRODUCT_LABEL: Record<RatingProduct, string> = { pages: 'בניית דפי נחיתה', seo: 'קידום העסק בגוגל' };
export const CONSENT_LABEL = 'מסכימים שנציג את הדירוג באתר עם השם וסוג העסק';

export interface MyRating { stars: number; text: string; displayName: string; businessType: string; consentPublish: boolean; status: 'pending' | 'approved' | 'rejected' }
export interface MyProduct { eligible: boolean; ask: boolean; rating: MyRating | null }
export type MyRatings = Record<RatingProduct, MyProduct>;

export interface PublicRating { stars: number; text: string; name: string; businessType: string; date: string }
export interface PublicSummary { product: RatingProduct; show: boolean; count: number; average: number | null; ratings: PublicRating[] }

export async function fetchMine(): Promise<MyRatings | null> {
  try {
    const r = await authFetch('/api/ratings/mine');
    if (!r.ok) return null;
    const j = (await r.json()) as { products?: MyRatings };
    return j.products ?? null;
  } catch { return null; }
}

export async function saveRating(product: RatingProduct, v: Omit<MyRating, 'status'>): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await authFetch('/api/ratings/mine', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ product, ...v }) });
    if (r.ok) return { ok: true };
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error ?? 'לא הצלחנו לשמור. נסו שוב.' };
  } catch { return { ok: false, error: 'אין חיבור כרגע. נסו שוב.' }; }
}

export async function dismissAsk(product: RatingProduct): Promise<void> {
  try { await authFetch('/api/ratings/mine/dismiss', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ product }) }); } catch { /* best effort */ }
}

export async function fetchPublic(product: RatingProduct): Promise<PublicSummary | null> {
  try {
    const r = await fetch(`/api/ratings/public?product=${product}`);
    if (!r.ok) return null;
    return (await r.json()) as PublicSummary;
  } catch { return null; }
}
