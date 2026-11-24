// ONE wording for the account's billing/entitlement state of the Google-promotion product (README part 151).
// The server derives the state (src/services/seoBillingState.ts, `access` in GET /api/seo/subscription);
// every screen that talks about paying for the product renders it through these helpers: the plan page
// (/seo-plan), the settings card (SeoSubscriptionCard) and the publish dialog of the included page.
// Pure: no React, no fetch, so scripts/test-qa-billing.ts can check every state.

export const BILLING_STATES = ['none', 'grant', 'monthly', 'annual', 'canceled_until', 'past_due'] as const;
export type BillingStateKind = (typeof BILLING_STATES)[number];

export interface BillingAccess {
  state: BillingStateKind;
  /** grant: end of the access (null = no end date); paying states: end of the paid period. */
  until: string | null;
  cycle: 'month' | 'year' | null;
  renewalPending?: boolean;
  /** none: when an earlier subscription or grant ended. */
  endedAt?: string | null;
}

/** What the screen offers next. `cancel` is the visible "ביטול המנוי" of a paying subscriber. */
export type BillingAction = 'join' | 'plans' | 'renew' | 'update_card' | 'cancel' | null;

export interface BillingCopy {
  state: BillingStateKind;
  title: string;
  line: string;
  /** What happens next / after the date. */
  after: string;
  action: BillingAction;
}

/** Days a past-due account keeps access after its period (src/services/entitlements.service.ts). */
export const PAST_DUE_GRACE_DAYS = 7;

export function dateHe(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try { return d.toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' }); } catch { return d.toLocaleDateString('he-IL'); }
}

const fmtILS = (n: number) => `₪${Math.round(n).toLocaleString('en-US')}`;
const STOPS = 'הפוסטים והתשובות לביקורות ייעצרו, ודף הנחיתה הכלול יוקפא (התוכן והפניות נשמרים)';

/**
 * The wording of a state. `price` = what the next monthly charge will be (monthly only); `renews` = false
 * when SUMIT holds no standing order we know of (the screen must not promise a charge nothing will make).
 */
export function billingCopy(a: BillingAccess, opts: { price?: number | null; renews?: boolean } = {}): BillingCopy {
  const until = dateHe(a.until);
  switch (a.state) {
    case 'grant':
      return {
        state: a.state,
        title: until ? `גישה ניסיונית עד ${until}` : 'גישה ניסיונית',
        line: 'קידום העסק בגוגל פעיל בחשבון שלכם בלי חיוב, כחלק מגישה ניסיונית. אין לכם מנוי בתשלום, ולכן אין מה לבטל.',
        after: until
          ? `ב-${until} הגישה מסתיימת: ${STOPS}. כדי להמשיך, מצטרפים למנוי בתשלום. לא נחייב אתכם בלי שתצטרפו.`
          : `לגישה הזו לא נקבע תאריך סיום. כשהיא תסתיים, ${STOPS}, אלא אם תצטרפו למנוי בתשלום. לא נחייב אתכם בלי שתצטרפו.`,
        action: 'plans',
      };
    case 'monthly':
      return {
        state: a.state,
        title: 'מנוי חודשי פעיל',
        line: opts.renews === false
          ? `המנוי פעיל${until ? ` עד ${until}` : ''}.`
          : `המנוי מתחדש כל חודש${opts.price ? ` ב-${fmtILS(opts.price)}` : ''}${until ? `. החיוב הבא ב-${until}` : ''}.`,
        after: 'אפשר לבטל בכל רגע. הביטול עוצר את החיובים הבאים, והגישה נשארת עד סוף התקופה ששולמה.',
        action: 'cancel',
      };
    case 'annual':
      return {
        state: a.state,
        title: 'מנוי שנתי פעיל',
        line: `שולם לשנה${until ? `, ותקף עד ${until}` : ''}. המנוי לא מתחדש אוטומטית, ונשלח תזכורת לפני הסיום.`,
        after: 'אפשר לבטל בכל רגע. אחרי 14 הימים הראשונים אין החזר על חודשים שנותרו, בכפוף לזכויות הביטול לפי דין.',
        action: 'cancel',
      };
    case 'canceled_until':
      return {
        state: a.state,
        title: 'המנוי בוטל',
        line: `לא יהיו חיובים נוספים. הגישה נשארת${until ? ` עד ${until}` : ' עד סוף התקופה ששולמה'}.`,
        after: `${until ? `ב-${until}` : 'בסוף התקופה'} ${STOPS}. אפשר לחדש את המנוי לפני כן.`,
        action: 'renew',
      };
    case 'past_due': {
      if (a.renewalPending) {
        return {
          state: a.state,
          title: 'המנוי החודשי מתחדש',
          line: 'החיוב החודשי מתבצע בימים אלה. אין צורך לעשות דבר.',
          after: 'אם החיוב לא יעבור, נודיע לכם כאן ובמייל.',
          action: null,
        };
      }
      const graceIso = a.until ? new Date(new Date(a.until).getTime() + PAST_DUE_GRACE_DAYS * 86400000).toISOString() : null;
      const grace = dateHe(graceIso);
      return {
        state: a.state,
        title: 'החיוב האחרון לא עבר',
        line: `כדי שהקידום ימשיך בלי הפסקה, עדכנו את אמצעי התשלום${grace ? ` עד ${grace}` : ''}.`,
        after: `אם החיוב לא יוסדר${grace ? ' עד אז' : ''}, ${STOPS}.`,
        action: 'update_card',
      };
    }
    case 'none':
    default: {
      const ended = dateHe(a.endedAt);
      return {
        state: 'none',
        title: 'אין לכם מנוי לקידום בגוגל',
        line: ended ? `הגישה לקידום העסק בגוגל הסתיימה ב-${ended}. אין חיוב.` : 'אין חיוב, ואין כרגע גישה לקידום העסק בגוגל.',
        after: 'אפשר להצטרף למנוי חודשי או שנתי. החודשי מתבטל בכל רגע.',
        action: 'join',
      };
    }
  }
}

export interface IncludedPageCopy { title: string; line: string; after: string; success: string }

/**
 * The publish dialog of the page included with the product. `a` = null while the state is still loading
 * (or could not be read): neutral words that are true in every state.
 */
export function includedPageCopy(a: BillingAccess | null): IncludedPageCopy {
  const until = dateHe(a?.until);
  if (a?.state === 'grant') {
    return {
      title: 'הדף כלול בגישה הניסיונית שלכם',
      line: 'הגישה לקידום העסק בגוגל כוללת דף נחיתה אחד באוויר. הפרסום בלי תשלום ובלי לנצל קרדיט.',
      after: until
        ? `הדף באוויר עד ${until}, סוף הגישה הניסיונית. אחר כך הוא יוקפא (התוכן והפניות נשמרים), אלא אם תצטרפו למנוי בתשלום.`
        : 'הדף באוויר כל עוד הגישה הניסיונית פעילה. כשהיא תסתיים הדף יוקפא (התוכן והפניות נשמרים), אלא אם תצטרפו למנוי בתשלום.',
      success: 'הדף כלול בגישה הניסיונית שלכם, ולא חויבתם עליו. הדף כעת גלוי לציבור.',
    };
  }
  if (a && (a.state === 'monthly' || a.state === 'annual' || a.state === 'past_due' || a.state === 'canceled_until')) {
    return {
      title: 'הדף כלול במנוי שלכם',
      line: 'מנוי הקידום בגוגל כולל דף נחיתה אחד באוויר. הפרסום בלי תשלום נוסף ובלי לנצל קרדיט.',
      after: a.state === 'canceled_until'
        ? `המנוי בוטל, ולכן הדף באוויר${until ? ` עד ${until}` : ' עד סוף התקופה ששולמה'}. אחר כך הוא יוקפא, והתוכן והפניות יישמרו.`
        : 'הדף נשאר באוויר כל עוד המנוי פעיל. אם המנוי יסתיים, הדף יוקפא, והתוכן והפניות יישמרו.',
      success: 'הדף כלול במנוי הקידום שלכם, ולא חויבתם עליו. הדף כעת גלוי לציבור.',
    };
  }
  return {
    title: 'הדף כלול בקידום בגוגל',
    line: 'הגישה שלכם לקידום העסק בגוגל כוללת דף נחיתה אחד באוויר. הפרסום בלי תשלום נוסף ובלי לנצל קרדיט.',
    after: 'הדף נשאר באוויר כל עוד הגישה לקידום בגוגל פעילה. אם היא תסתיים, הדף יוקפא, והתוכן והפניות יישמרו.',
    success: 'הדף כלול בקידום בגוגל שלכם, ולא חויבתם עליו. הדף כעת גלוי לציבור.',
  };
}

// ─── ₪1 minimum (MIN_CHARGE) ────────────────────────────────────────────────

/** The server's floor for any charge (src/services/coupon.service.ts MIN_CHARGE). */
export const MIN_CHARGE = 1;

/**
 * A code that covers the whole price still charges ₪1 (product decision, README part 151): a monthly
 * standing order needs a card on file, and SUMIT takes no ₪0 payment. Never show a bare "₪1": say what it is.
 * Returns null when the price did not stop at the floor.
 */
export function minChargeNote(
  q: { finalAmount: number; discountAmount: number; minCharge?: boolean },
  cycle: 'month' | 'year',
): { priceLabel: string; explain: string; button: string } | null {
  const atFloor = q.minCharge ?? (q.discountAmount > 0 && q.finalAmount <= MIN_CHARGE);
  if (!atFloor) return null;
  return {
    priceLabel: '₪1 בלבד לאימות אמצעי התשלום',
    explain: cycle === 'month'
      ? 'קוד ההנחה מכסה את כל החודש הראשון. ₪1 הוא הסכום המינימלי לחיוב, והוא נדרש כדי לשמור את אמצעי התשלום להוראת הקבע.'
      : 'קוד ההנחה מכסה את כל השנה. ₪1 הוא הסכום המינימלי שמערכת התשלומים מאפשרת, והוא מאמת את אמצעי התשלום.',
    button: 'מעבר לאימות אמצעי התשלום · ₪1',
  };
}

/** The words the admin coupon form shows before creating a code that reaches the ₪1 floor. */
export const MIN_CHARGE_ADMIN_WARNING = 'המינימום לחיוב הוא ₪1 (נדרש כדי לשמור אמצעי תשלום להוראת הקבע). לקוח עם הקוד הזה ישלם ₪1, ובדף התשלום יופיע "₪1 בלבד לאימות אמצעי התשלום".';

/** Would a code of this shape bring any of these subscription prices down to the ₪1 floor? */
export function minChargeAdminWarning(type: 'percent' | 'fixed', value: number, prices: number[]): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const hits = prices.some(price => price - (type === 'percent' ? (price * value) / 100 : value) <= MIN_CHARGE);
  return hits ? MIN_CHARGE_ADMIN_WARNING : null;
}

// ─── Opening the checkout ───────────────────────────────────────────────────

/** After this long, the button admits it is slow (README part 151). */
export const CHECKOUT_SLOW_MS = 6000;
/** The browser gives up and offers a retry (the server gives up on SUMIT at 20 s). */
export const CHECKOUT_TIMEOUT_MS = 30000;

/** The progressive text while the server opens SUMIT's page. */
export function checkoutPhaseText(elapsedMs: number): string {
  return elapsedMs >= CHECKOUT_SLOW_MS ? 'זה לוקח קצת יותר מהרגיל…' : 'מתחברים למערכת התשלומים המאובטחת…';
}

export const CHECKOUT_TIMEOUT_TEXT = 'מערכת התשלומים לא ענתה בזמן. לא בוצע שום חיוב. נסו שוב בעוד רגע.';
