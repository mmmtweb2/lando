// Sample data for the preview mode (?preview=ongoing): a made-up business, so the screens can be
// looked at and screenshotted without a server. Nothing here is sent anywhere; actions change this
// in-memory copy only. `&sample=approved` shows the state after the customer approved the card (with
// one review reply waiting for them), `&sample=quiet` the same with nothing waiting.
// `&landing=existing` / `&landing=error` choose what "צרו לי דף נחיתה" answers; without it a draft is
// "created" after a few seconds. `&page=draft|live|frozen` starts with the included landing page already
// there in that state (without it: no page yet), so "הדף והחיפושים שלכם" can be seen in every state.
import type { LeadsSummary } from '../../../components/LeadsTable';
import type { Activity, Automation, GbpStatus, LandingResult, Phrases, Post, Truth } from './types';

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const ahead = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

export interface SampleState { truth: Truth; gbp: GbpStatus; automation: Automation; posts: Post[]; activity: Activity[]; page: LandingResult | null; phrases: Phrases }
export type SampleVariant = 'pending' | 'approved' | 'quiet';

export function sampleVariant(): SampleVariant {
  try { const q = new URLSearchParams(window.location.search).get('sample'); return q === 'approved' || q === 'quiet' ? q : 'pending'; } catch { return 'pending'; }
}

export function sampleLanding(): 'create' | 'existing' | 'error' {
  try { const q = new URLSearchParams(window.location.search).get('landing'); return q === 'existing' || q === 'error' ? q : 'create'; } catch { return 'create'; }
}

/** The included landing page the sample starts with: none, or one in the asked state. */
export function samplePage(): LandingResult | null {
  let q: string | null = null;
  try { q = new URLSearchParams(window.location.search).get('page'); } catch { /* none */ }
  const status = q === 'live' ? 'published' : q === 'draft' || q === 'frozen' ? q : null;
  return status ? { existing: true, id: 'sample-page', slug: 'sample-page', status } : null;
}

/** This month's inquiries in the sample (the real ones come from the account's own pages). */
export function sampleSummary(): LeadsSummary {
  return sampleVariant() === 'pending'
    ? { month_total: 0, month_whatsapp: 0, month_call: 0, month_form: 0, month_email: 0, month_link: 0 }
    : { month_total: 14, month_whatsapp: 6, month_call: 5, month_form: 2, month_email: 1, month_link: 0 };
}

/** Never on Shabbat or at night, like the server: the next weekday morning when the time falls there. */
function openTime(iso: string): string {
  const d = new Date(iso);
  for (let i = 0; i < 80; i++) {
    const day = d.getDay(), h = d.getHours();
    const closed = h < 8 || h >= 20 || (day === 5 && h >= 14) || day === 6;
    if (!closed) break;
    d.setHours(d.getHours() + 1, 0, 0, 0);
  }
  return d.toISOString();
}

/** Review reply drafts that wait for the owner in the sample: the one the sample's activity log mentions. */
export function samplePendingReplies(): number {
  return sampleVariant() === 'approved' ? 1 : 0;
}

export function buildSample(variant: SampleVariant): SampleState {
  const approved = variant !== 'pending';
  const truth: Truth = {
    fetchedAt: ago(30), approvedAt: approved ? ago(380) : null,
    card: {
      name: 'אינסטלציה אבי כהן', phone: '052-555-0142', website: '', address: 'הרצל 48, רחובות', city: 'רחובות',
      category: 'אינסטלטור', categories: ['שירות לתיקון דוד שמש'],
      description: 'אינסטלטור מוסמך ברחובות והסביבה. תיקון נזילות, פתיחת סתימות והחלפת דודים, לבתים פרטיים ולבניינים.',
      services: [
        { name: 'תיקון נזילות', description: 'איתור ותיקון נזילות בקירות ובצנרת', source: 'google' },
        { name: 'פתיחת סתימות', description: '', source: 'google' },
        { name: 'החלפת דוד שמש', description: 'כולל פינוי הדוד הישן', source: 'customer' },
        { name: 'התקנת ברזים וכלים סניטריים', description: '', source: 'customer' },
      ],
      areas: ['רחובות', 'נס ציונה', 'יבנה', 'גדרה'],
      hours: [
        ...(['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'] as const).map((day) => ({ day, open: '08:00', close: '18:00' })),
        { day: 'FRIDAY', open: '08:00', close: '13:00' },
      ],
      open: true,
      notes: approved ? 'עובד לבד כבר 14 שנה, מגיע בעצמי לכל קריאה. נותן הצעת מחיר לפני שמתחילים, בלי הפתעות.' : '',
    },
    readiness: {
      ready: true, total: 9, done: approved ? 7 : 6,
      checks: [
        { key: 'open', required: true, state: 'ok', title: 'העסק מסומן כפתוח בגוגל', why: 'גוגל כמעט לא מציגה עסק שמסומן כסגור, ואי אפשר לפרסם בכרטיס שלו.' },
        { key: 'category', required: true, state: 'ok', title: 'קטגוריה ראשית', why: 'לפי הקטגוריה גוגל מחליטה באילו חיפושים להציג אתכם.' },
        { key: 'phone', required: true, state: 'ok', title: 'טלפון', why: 'רוב הפניות מכרטיס העסק הן שיחות טלפון.' },
        { key: 'services', required: true, state: 'ok', title: 'רשימת שירותים', why: 'מהשירותים אנחנו כותבים את הפוסטים ואת הדפים, וגוגל מתאימה אותם לחיפושים.' },
        { key: 'description', required: false, state: 'weak', title: 'תיאור העסק', why: 'תיאור מלא עוזר ללקוח להחליט לפנות, ולגוגל להבין מה אתם עושים.' },
        { key: 'hours', required: false, state: 'ok', title: 'שעות פעילות', why: 'עסק בלי שעות מוצג פחות, ולקוחות חוששים להגיע.' },
        { key: 'areas', required: false, state: 'ok', title: 'אזורי שירות', why: 'כך אנחנו יודעים על אילו יישובים לכתוב.' },
        { key: 'website', required: false, state: 'missing', title: 'אתר או דף נחיתה', why: 'קישור מהכרטיס מוסיף אמינות ונותן ללקוח מקום להשאיר פרטים.' },
        { key: 'notes', required: false, state: approved ? 'ok' : 'missing', title: 'מה מיוחד אצלכם', why: 'כמה משפטים משלכם הופכים את הפוסטים מכלליים לאישיים.' },
      ],
    },
  };
  const posts: Post[] = approved ? [
    { id: 'sample-3', topic: 'החלפת דוד שמש', status: 'scheduled', edited: false, publishAfter: ahead(31), expectedAt: openTime(ahead(31)), publishedAt: null, createdAt: ago(17), problem: null,
      body: 'הדוד מטפטף או שהמים כבר לא מתחממים כמו פעם? אנחנו מחליפים דודי שמש ברחובות, בנס ציונה וביבנה, כולל פינוי הדוד הישן.\n\nלפני שמתחילים תקבלו הצעת מחיר מסודרת. אפשר להתקשר ולתאם ביקור.' },
    { id: 'sample-2', topic: 'פתיחת סתימות', status: 'published', edited: true, publishAfter: ago(140), publishedAt: ago(139), createdAt: ago(190), problem: null,
      body: 'כיור שמתרוקן לאט הוא סימן שכדאי לטפל בו לפני שהוא נסתם לגמרי. אנחנו פותחים סתימות בכיורים, באמבטיות ובקווי ביוב ברחובות והסביבה.' },
    { id: 'sample-1', topic: 'תיקון נזילות', status: 'published', edited: false, publishAfter: ago(310), publishedAt: ago(308), createdAt: ago(360), problem: null,
      body: 'כתם רטוב על הקיר או חשבון מים שקפץ? אנחנו מאתרים את מקור הנזילה ומתקנים אותו, בבתים פרטיים ובבניינים באזור רחובות.' },
  ] : [];
  const activity: Activity[] = approved ? [
    { id: 'a7', kind: 'post_planned', title: 'כתבנו את הפוסט של השבוע: החלפת דוד שמש', detail: 'הוא מחכה כאן לקריאה שלכם לפני הפרסום.', createdAt: ago(17) },
    { id: 'a6', kind: 'reply_published', title: 'ענינו לביקורת של 5 כוכבים מרונית ל׳', detail: 'תודה רבה, רונית! שמחנו לעזור, ונשמח לעמוד לשירותכם גם בהמשך.', createdAt: ago(41) },
    { id: 'a5', kind: 'reply_drafted', title: 'הכנו טיוטת תשובה לביקורת של 2 כוכבים', detail: 'היא מחכה לאישור שלכם במסך הביקורות.', createdAt: ago(66) },
    { id: 'a4', kind: 'post_published', title: 'פרסמנו פוסט בכרטיס העסק שלכם בגוגל: פתיחת סתימות', detail: null, createdAt: ago(139) },
    { id: 'a3', kind: 'page_created', title: 'יצרנו דף: אינסטלטור בנס ציונה', detail: null, createdAt: ago(200) },
    { id: 'a2', kind: 'post_published', title: 'פרסמנו פוסט בכרטיס העסק שלכם בגוגל: תיקון נזילות', detail: null, createdAt: ago(308) },
    { id: 'a1', kind: 'card_approved', title: 'אישרתם את פרטי העסק, ואנחנו מתחילים לעבוד', detail: null, createdAt: ago(380) },
    { id: 'a0', kind: 'card_synced', title: 'קראנו את פרטי העסק מכרטיס העסק שלכם בגוגל', detail: null, createdAt: ago(384) },
  ] : [
    { id: 'a0', kind: 'card_synced', title: 'קראנו את פרטי העסק מכרטיס העסק שלכם בגוגל', detail: null, createdAt: ago(30) },
  ];
  const page = samplePage();
  const phrases: Phrases = {
    hasPage: page !== null, parentPublished: page?.status === 'published', cap: 5, left: 4,
    pages: page ? [{ id: 'sample-phrase-0', phrase: 'אינסטלטור בנס ציונה', title: 'אינסטלטור בנס ציונה', url: '' }] : [],
    ideas: [
      { phrase: 'החלפת דוד שמש ברחובות', service: 'החלפת דוד שמש', area: 'רחובות' },
      { phrase: 'פתיחת סתימות ביבנה', service: 'פתיחת סתימות', area: 'יבנה' },
      { phrase: 'תיקון נזילות בגדרה', service: 'תיקון נזילות', area: 'גדרה' },
    ],
  };
  return {
    truth, posts, page, phrases,
    activity: variant === 'quiet' ? activity.filter((a) => a.kind !== 'reply_drafted') : activity,
    gbp: { enabled: true, connected: true, needsReconnect: false },
    automation: { postsMode: 'auto', repliesMode: 'auto_positive', consentAt: approved ? ago(380) : null, live: approved, editWindowHours: 48 },
  };
}
