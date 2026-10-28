// Pure logic for the v2 overview: what the customer sees as "journey", "next step" and the one-line
// status. No React, no network: everything is derived from data the dashboard already loads
// (connected business, content, month's inquiries, subscription). No Google Places data is read or
// stored here — the profile score is deliberately NOT kept (Places terms), so the overview never
// pretends to know it; it asks the customer to run the check.

export type View = 'overview' | 'profile' | 'reviews' | 'content' | 'leads' | 'plan';

export interface OverviewInput {
  loaded: boolean;
  businessName: string | null;
  hasBusiness: boolean;
  /** content kits + search pages the customer already created for the connected business */
  contentCount: number;
  monthLeads: number;
  subscriptionStatus: 'active' | 'past_due' | 'canceled' | null;
}

export type StepState = 'done' | 'yours' | 'ours' | 'waiting';

export interface JourneyStep {
  id: 'connect' | 'check' | 'plan' | 'reviews' | 'content' | 'leads';
  title: string;
  detail: string;
  who: 'we' | 'you';
  state: StepState;
  /** chip text; defaults by state */
  chip: string;
  view: View;
}

const CHIP: Record<StepState, string> = { done: 'בוצע', yours: 'תורך', ours: 'אנחנו עובדים', waiting: 'ממתין' };

export function inquiriesText(n: number): string {
  return n === 1 ? 'פנייה אחת' : `${n} פניות`;
}

export function deriveJourney(i: OverviewInput): JourneyStep[] {
  const has = i.hasBusiness;
  const step = (s: Omit<JourneyStep, 'chip'> & { chip?: string }): JourneyStep => ({ ...s, chip: s.chip ?? CHIP[s.state] });
  return [
    step({
      id: 'connect', title: 'חיבור העסק', who: 'you', view: 'profile',
      detail: has ? `${i.businessName ?? 'העסק'} מחובר.` : 'מחפשים את העסק בגוגל מפות ושומרים אותו כאן.',
      state: has ? 'done' : 'yours',
    }),
    step({
      id: 'check', title: 'בדיקת הפרופיל', who: 'we', view: 'profile',
      detail: has ? 'משווים את הפרופיל לשלושת העסקים המובילים באזור. הבדיקה רצה כשלוחצים.' : 'אחרי חיבור העסק נבדוק אותו מול המובילים.',
      state: has ? 'yours' : 'waiting',
      chip: has ? 'בדוק עכשיו' : undefined,
    }),
    step({
      id: 'plan', title: 'תוכנית חיזוק', who: 'you', view: 'profile',
      detail: has ? 'בתוצאות הבדיקה מופיע מה לחזק ומי עושה מה. את מה שרק בעל העסק יכול לעשות, עושים אתם.' : 'מופיעה בתוצאות הבדיקה.',
      state: has ? 'yours' : 'waiting',
    }),
    step({
      id: 'reviews', title: 'ביקורות', who: 'we', view: 'reviews',
      detail: has ? 'מקבלים קישור וקוד QR לביקורת, ווידג׳ט ביקורות לאתר. אתם שולחים ללקוחות מרוצים.' : 'אחרי חיבור העסק נכין קישור ביקורות.',
      state: has ? 'yours' : 'waiting',
    }),
    step({
      id: 'content', title: 'תוכן ודפים', who: 'we', view: 'content',
      detail: i.contentCount > 0
        ? `כבר יש ${i.contentCount === 1 ? 'פריט תוכן אחד' : `${i.contentCount} פריטי תוכן`} לעסק.`
        : has ? 'בוחרים ביטויי חיפוש, ואנחנו מכינים ערכות תוכן עם שאלות ותשובות ודפי חיפוש.' : 'אחרי חיבור העסק נבנה תוכנית תוכן.',
      state: i.contentCount > 0 ? 'done' : has ? 'yours' : 'waiting',
    }),
    step({
      id: 'leads', title: 'פניות', who: 'we', view: 'leads',
      detail: i.monthLeads > 0
        ? `החודש הגיעו ${inquiriesText(i.monthLeads)}.`
        : has ? 'אנחנו סופרים פניות מדפי Pagey ומהאתר שלכם (עם קוד מעקב). עדיין אין פניות החודש.' : 'כאן יופיעו הפניות שיגיעו.',
      state: i.monthLeads > 0 ? 'done' : has ? 'ours' : 'waiting',
      chip: i.monthLeads === 0 && has ? 'אנחנו עוקבים' : undefined,
    }),
  ];
}

export function journeyProgress(steps: JourneyStep[]): { done: number; total: number; percent: number } {
  const done = steps.filter((s) => s.state === 'done').length;
  return { done, total: steps.length, percent: Math.round((done / steps.length) * 100) };
}

export interface NextStep { title: string; body: string; cta: string; view: View; urgent: boolean }

/** One clear action, picked by priority from the state of the account. */
export function deriveNextStep(i: OverviewInput): NextStep {
  if (i.subscriptionStatus === 'past_due') {
    return {
      title: 'התשלום החודשי לא עבר', urgent: true, view: 'plan', cta: 'לפרטי המנוי',
      body: 'כדי שהקידום ימשיך בלי הפרעה, כדאי לעדכן את אמצעי התשלום בימים הקרובים.',
    };
  }
  if (!i.hasBusiness) {
    return {
      title: 'חברו את העסק שלכם', urgent: false, view: 'profile', cta: 'לחיבור העסק',
      body: 'מחפשים את העסק בגוגל מפות. אם אין לו פרופיל, נראה לכם איך פותחים אחד.',
    };
  }
  if (i.contentCount === 0) {
    return {
      title: 'בדקו איפה הפרופיל עומד מול המובילים', urgent: false, view: 'profile', cta: 'בדוק עכשיו',
      body: 'הבדיקה לוקחת כמה שניות, ומראה מה כדאי לחזק קודם.',
    };
  }
  if (i.monthLeads === 0) {
    return {
      title: 'קחו את קישור הביקורות ושלחו ללקוחות מרוצים', urgent: false, view: 'reviews', cta: 'לקישור הביקורות',
      body: 'ביקורות חדשות משפיעות על המקום שלכם בגוגל מפות, ומביאות פניות.',
    };
  }
  return {
    title: 'הפניות מגיעות. כדאי לעבור עליהן', urgent: false, view: 'leads', cta: 'לפניות שלי',
    body: `החודש הגיעו ${inquiriesText(i.monthLeads)}. כדאי לחזור אליהן מהר.`,
  };
}

export function statusLine(i: OverviewInput): string {
  if (!i.hasBusiness) return 'עוד לא חיברתם עסק. זה הצעד הראשון, והוא לוקח דקה.';
  const leads = i.monthLeads > 0 ? `החודש הגיעו ${inquiriesText(i.monthLeads)}.` : 'עדיין אין פניות החודש.';
  return `${i.businessName ?? 'העסק'} מחובר. ${leads} כדי לראות את הציון מול המובילים באזור, לחצו ״בדוק עכשיו״.`;
}

export const VIEW_LABEL: Record<View, string> = {
  overview: 'סקירה',
  profile: 'הפרופיל שלי',
  reviews: 'ביקורות',
  content: 'תוכן ודפים',
  leads: 'פניות',
  plan: 'מנוי והגדרות',
};
export const VIEW_ORDER: View[] = ['overview', 'profile', 'reviews', 'content', 'leads', 'plan'];
