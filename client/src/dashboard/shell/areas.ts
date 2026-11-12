// The dashboard's one navigation model (docs/dashboard-v4-spec.md). Pure: no React, no network.
//
// Two products share the account and stay two products in the customer's eyes:
//   "קידום בגוגל"  (a subscription; includes ONE landing page since 12.11.2026)
//   "דפי נחיתה"    (Pagey: pages bought one by one, with page credits and AI credits)
// One sidebar, grouped by product. What a group shows depends on what the account holds.

export type AccountKind = 'promo' | 'pages' | 'both';

export type PromoArea =
  | 'home' | 'reviews' | 'site' | 'business' | 'automation'
  /* reached from inside a screen, not from the sidebar */
  | 'activity' | 'extras'
  /* the screens of an account where the automatic product is not open yet */
  | 'progress' | 'more' | 'profile' | 'content' | 'inquiries' | 'setup';
export type PagesArea = 'pages' | 'leads' | 'credits';
export type AreaId = PromoArea | PagesArea | 'settings';

const PROMO: readonly PromoArea[] = ['home', 'reviews', 'site', 'business', 'automation', 'activity', 'extras', 'progress', 'more', 'profile', 'content', 'inquiries', 'setup'];
const PAGES: readonly PagesArea[] = ['pages', 'leads', 'credits'];
const ALL: readonly string[] = [...PROMO, ...PAGES, 'settings'];

export const isPromoArea = (a: AreaId): a is PromoArea => (PROMO as readonly string[]).includes(a);
export const isPagesArea = (a: AreaId): a is PagesArea => (PAGES as readonly string[]).includes(a);

/**
 * What the promotion product looks like in this account:
 *   auto    – the automatic product is open (docs/mvp-plan.md)
 *   legacy  – it is not open yet: the account keeps the screens it had
 *   setup   – the one-time setup is still running: one focused screen
 *   classic – the older dashboards (?dash=v1 / ?dash=v2), which carry their own inner navigation
 *   unknown – still loading
 */
export type PromoMode = 'unknown' | 'auto' | 'legacy' | 'setup' | 'classic';

export interface KindInput {
  /** entitlement seo_autopilot */
  hasSeo: boolean;
  /** root pages the account owns (phrase pages are not counted) */
  pageCount: number;
  /** page-publish balance, and everything ever bought */
  pageCredits: number;
  pageCreditsTotal: number;
}

/**
 * Promotion only, pages only, or both. Every account "may" build pages, so the entitlement cannot
 * tell: an account counts as holding the pages product when it ever bought page credits, or owns a
 * page beyond the one that comes with the promotion subscription.
 */
export function accountKind(i: KindInput): AccountKind {
  if (!i.hasSeo) return 'pages';
  return i.pageCount > 1 || i.pageCredits > 0 || i.pageCreditsTotal > 0 ? 'both' : 'promo';
}

export const AREA_LABEL: Record<AreaId, string> = {
  home: 'בית', reviews: 'ביקורות', site: 'הדף והחיפושים שלכם', business: 'פרטי העסק', automation: 'מה מתפרסם לבד',
  activity: 'מה עשינו בשבילכם', extras: 'רוצים לעשות עוד בעצמכם?',
  progress: 'התקדמות', more: 'עוד', profile: 'הכרטיס שלכם בגוגל', content: 'תוכן', inquiries: 'פניות', setup: 'רשימת ההקמה',
  pages: 'הדפים שלי', leads: 'לידים', credits: 'קרדיטים',
  settings: 'הגדרות וחיוב',
};

export const PROMO_LABEL = 'קידום בגוגל';
export const PAGES_LABEL = 'דפי נחיתה';

export interface NavGroup { product: 'promo' | 'pages'; label: string; items: AreaId[] }
export interface NavModel {
  groups: NavGroup[];
  /** a quiet way to the product the account does not hold */
  offer: 'promo' | 'pages' | null;
  bottom: AreaId[];
}

function promoItems(mode: PromoMode): AreaId[] {
  if (mode === 'auto') return ['home', 'reviews', 'site', 'business', 'automation'];
  if (mode === 'legacy') return ['home', 'reviews', 'progress', 'more'];
  if (mode === 'unknown') return ['home', 'reviews'];
  return ['home'];   // setup, classic: one entry, the screen carries the rest
}

export function navFor(kind: AccountKind, mode: PromoMode): NavModel {
  const groups: NavGroup[] = [];
  if (kind !== 'pages') groups.push({ product: 'promo', label: PROMO_LABEL, items: promoItems(mode) });
  if (kind !== 'promo') groups.push({ product: 'pages', label: PAGES_LABEL, items: ['pages', 'leads', 'credits'] });
  return { groups, offer: kind === 'pages' ? 'promo' : kind === 'promo' ? 'pages' : null, bottom: ['settings'] };
}

/** An area the account cannot have falls back to the nearest one it does have. */
export function resolveArea(kind: AccountKind, requested: AreaId | null): AreaId {
  const fallback: AreaId = kind === 'pages' ? 'pages' : 'home';
  if (!requested) return fallback;
  if (requested === 'settings') return requested;
  if (isPromoArea(requested)) return kind === 'pages' ? fallback : requested;
  // promotion only: the page lives under the promotion product, and there are no credits to show
  if (kind === 'promo') return requested === 'pages' ? 'site' : fallback;
  return requested;
}

/** Which sidebar entry is lit for a screen that has none of its own. */
export function navParent(area: AreaId, mode: PromoMode): AreaId {
  if (!isPromoArea(area)) return area;
  if (mode === 'unknown') return area === 'reviews' ? 'reviews' : 'home';
  if (mode === 'classic' || mode === 'setup') return 'home';
  if (mode === 'auto') {
    if (area === 'activity' || area === 'extras' || area === 'more' || area === 'progress' || area === 'content' || area === 'inquiries' || area === 'setup') return 'home';
    if (area === 'profile') return 'business';
    return area;
  }
  // legacy
  if (area === 'profile' || area === 'content' || area === 'inquiries' || area === 'setup') return 'more';
  if (area === 'site' || area === 'automation' || area === 'activity' || area === 'extras') return 'home';
  if (area === 'business') return 'more';
  return area;
}

/**
 * The area a URL asks for. `?area=` is the canonical form; the older deep links keep working:
 * ?leads=1, ?renew=<id>, ?upgrade=1 / ?bundles=1, ?screen=card|automation, ?gbp=<result>.
 */
export function areaFromQuery(search: string): AreaId | null {
  let q: URLSearchParams;
  try { q = new URLSearchParams(search); } catch { return null; }
  const a = q.get('area');
  if (a === 'plan') return 'settings';
  if (a && ALL.includes(a)) return a as AreaId;
  if (q.get('leads') === '1') return 'leads';
  if (q.get('renew')) return 'pages';
  if (q.get('bundles') === '1' || q.get('upgrade') === '1') return 'credits';
  const screen = q.get('screen');
  if (screen === 'card') return 'business';
  if (screen === 'automation') return 'automation';
  if (q.has('gbp')) return 'profile';
  return null;
}

/** The query string that keeps `area` in the URL; one-shot deep-link params are dropped, the rest stays. */
export function queryWithArea(search: string, area: AreaId, isDefault: boolean): string {
  const q = new URLSearchParams(search);
  for (const k of ['leads', 'screen']) q.delete(k);
  if (isDefault) q.delete('area'); else q.set('area', area);
  const s = q.toString();
  return s ? `?${s}` : '';
}
