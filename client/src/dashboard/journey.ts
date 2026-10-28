// Pure logic of dashboard v2.1: two phases.
//   1. SETUP: a one-time checklist to get a stable business on Google, with a readiness score.
//   2. ONGOING: monitoring and growth (competitor check, more reviews, more inquiries).
// The customer is moved to phase 2 only when every setup step is done, and is told so once.
//
// No React, no network. Everything is derived from data the dashboard already loads plus the
// customer's own ticks for the steps done outside Pagey (migration 032). No Google Places data is
// read or stored: the profile score is deliberately never kept (Places terms), so nothing here
// pretends to know it; the customer runs the check when they want a fresh one.

export type View = 'overview' | 'profile' | 'reviews' | 'content' | 'leads' | 'plan' | 'setup';

/** Steps the customer ticks themselves (they happen outside Pagey, so we cannot detect them). */
export type ManualKey = 'first_check' | 'profile_details' | 'profile_verified' | 'review_link_shared' | 'tracking_ready';
export const MANUAL_KEYS: ManualKey[] = ['first_check', 'profile_details', 'profile_verified', 'review_link_shared', 'tracking_ready'];
export const PHASE2_ACK = 'phase2_ack';

export interface OverviewInput {
  loaded: boolean;
  businessName: string | null;
  hasBusiness: boolean;
  /** content kits + search pages the customer already created for the connected business */
  contentCount: number;
  monthLeads: number;
  subscriptionStatus: 'active' | 'past_due' | 'canceled' | null;
  /** keys the customer ticked (ManualKey plus 'phase2_ack') */
  ticks: string[];
}

export interface SetupItem {
  id: 'connect' | ManualKey | 'content';
  title: string;
  /** what to do, in plain words */
  how: string;
  who: 'we' | 'you';
  done: boolean;
  /** true when the customer ticks it; false when we detect it from real data */
  manual: boolean;
  view: View;
  cta: string;
}

export function inquiriesText(n: number): string {
  return n === 1 ? 'פנייה אחת' : `${n} פניות`;
}

export function deriveSetup(i: OverviewInput): SetupItem[] {
  const t = (k: ManualKey) => i.ticks.includes(k);
  return [
    { id: 'connect', title: 'חיבור העסק', who: 'you', manual: false, view: 'profile', cta: 'לחיבור העסק',
      how: 'מחפשים את העסק בגוגל מפות ושומרים אותו כאן. אם עוד אין לו פרופיל, נראה לכם איך פותחים אחד.', done: i.hasBusiness },
    { id: 'first_check', title: 'בדיקה ראשונה מול המובילים', who: 'we', manual: true, view: 'profile', cta: 'בדוק עכשיו',
      how: 'אנחנו משווים את הפרופיל לשלושת העסקים המובילים באזור, ואתם רואים מה חסר.', done: t('first_check') },
    { id: 'profile_details', title: 'השלמת פרטי הפרופיל בגוגל', who: 'you', manual: true, view: 'profile', cta: 'מה חסר לי',
      how: 'טלפון, שעות פתיחה ותמונות אמיתיות. את זה רק בעל העסק יכול לעדכן, בחשבון הגוגל שלו.', done: t('profile_details') },
    { id: 'profile_verified', title: 'אימות הפרופיל', who: 'you', manual: true, view: 'profile', cta: 'איך מאמתים',
      how: 'גוגל מבקשת לוודא שהעסק באמת שלכם. בלי אימות הפרופיל מוגבל.', done: t('profile_verified') },
    { id: 'review_link_shared', title: 'שליחת קישור ביקורות ללקוח ראשון', who: 'you', manual: true, view: 'reviews', cta: 'לקישור הביקורות',
      how: 'מקבלים קישור וקוד QR, ושולחים ללקוח מרוצה. ככה נבנות הביקורות הראשונות.', done: t('review_link_shared') },
    { id: 'content', title: 'תוכן החיפוש הראשון', who: 'we', manual: false, view: 'content', cta: 'לתוכן',
      how: 'בוחרים ביטויי חיפוש, ואנחנו מכינים ערכת תוכן או דף חיפוש.', done: i.contentCount > 0 },
    { id: 'tracking_ready', title: 'מעקב אחרי פניות', who: 'you', manual: true, view: 'leads', cta: 'להטמעה',
      how: 'דף Pagey, או שורת קוד אחת באתר שלכם, כדי שנספור שיחות, וואטסאפ ואימייל.', done: t('tracking_ready') || i.monthLeads > 0 },
  ];
}

export type ReadinessTier = 'start' | 'way' | 'almost' | 'ready';
export interface Readiness { done: number; total: number; percent: number; tier: ReadinessTier; label: string }

export function readiness(items: SetupItem[]): Readiness {
  const done = items.filter((s) => s.done).length;
  const percent = Math.round((done / items.length) * 100);
  const tier: ReadinessTier = done === items.length ? 'ready' : percent >= 70 ? 'almost' : percent >= 30 ? 'way' : 'start';
  const label = { start: 'בתחילת הדרך', way: 'בדרך הנכונה', almost: 'כמעט שם', ready: 'העסק מוקם' }[tier];
  return { done, total: items.length, percent, tier, label };
}

export type Phase = 'setup' | 'welcome' | 'ongoing';

/**
 * setup:   at least one setup step is open (also when the business was removed again)
 * welcome: everything is done and the customer has not yet been told about phase 2
 * ongoing: phase 2
 */
export function derivePhase(i: OverviewInput): Phase {
  const items = deriveSetup(i);
  if (!items.every((s) => s.done)) return 'setup';
  return i.ticks.includes(PHASE2_ACK) ? 'ongoing' : 'welcome';
}

export interface NextStep { title: string; body: string; cta: string; view: View; urgent: boolean }

/** One clear action. A failed payment always comes first; otherwise the first open setup step. */
export function deriveSetupNext(i: OverviewInput): NextStep | null {
  if (i.subscriptionStatus === 'past_due') return pastDue();
  const open = deriveSetup(i).find((s) => !s.done);
  if (!open) return null;
  return { title: open.title, body: open.how, cta: open.cta, view: open.view, urgent: false };
}

function pastDue(): NextStep {
  return {
    title: 'התשלום החודשי לא עבר', urgent: true, view: 'plan', cta: 'לפרטי המנוי',
    body: 'כדי שהקידום ימשיך בלי הפרעה, כדאי לעדכן את אמצעי התשלום בימים הקרובים.',
  };
}

/** Phase 2: the recommendation of the month. */
export function deriveOngoingNext(i: OverviewInput): NextStep {
  if (i.subscriptionStatus === 'past_due') return pastDue();
  if (i.monthLeads === 0) {
    return {
      title: 'שלחו את קישור הביקורות ללקוחות מרוצים', urgent: false, view: 'reviews', cta: 'לקישור הביקורות',
      body: 'עדיין אין פניות החודש. ביקורות חדשות משפיעות על המקום שלכם בגוגל מפות, ומביאות פניות.',
    };
  }
  return {
    title: 'בדקו איפה אתם עומדים מול המתחרים', urgent: false, view: 'profile', cta: 'בדוק עכשיו',
    body: `החודש הגיעו ${inquiriesText(i.monthLeads)}. בדיקה מחודשת מראה אם הפער מהמובילים השתנה.`,
  };
}

export const VIEW_LABEL: Record<View, string> = {
  overview: 'סקירה',
  profile: 'הפרופיל שלי',
  reviews: 'ביקורות',
  content: 'תוכן ודפים',
  leads: 'פניות',
  plan: 'מנוי והגדרות',
  setup: 'ההקמה שלי',
};
export const VIEW_ORDER: View[] = ['overview', 'profile', 'reviews', 'content', 'leads', 'plan'];
