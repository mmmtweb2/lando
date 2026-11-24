import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authFetch } from '../lib/api';
import { fmt } from '../config/pricing';
import { pageLine, type Catalog, type SeoCycle, type SeoPlanId } from '../lib/seoPlans';
import { billingCopy, dateHe, type BillingAccess } from '../lib/billingState';

// The billing card of the Google-promotion product, in settings (README part 151). It renders the ONE
// billing state the server derives (no access / access given by hand with its end date / paying monthly /
// paying annual / canceled until a date / last charge failed) in the same words as the plan page and the
// publish dialog (lib/billingState.ts). A paying subscriber always has a visible "ביטול המנוי" here, with
// the 14-day refund rules of part 136. Cancelling after 14 days keeps access to the end of the paid period.

interface Status {
  enabled: boolean;
  planName: string;
  price: number | null;
  catalog?: Catalog;
  subscription: {
    status: 'active' | 'past_due' | 'canceled'; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; renewalPending?: boolean;
    planId?: SeoPlanId; cycle?: SeoCycle; withPage?: boolean; renews?: boolean;
    page?: { included: boolean; pageId: string | null; status: string | null };
    /** Cancelling now returns the first payment in full (14 days from it, once per account). */
    refund?: { eligible: boolean; amount: number | null; until: string | null };
    /** Prices of this subscription (README part 148): list price, the first payment with a coupon, the next charge. */
    pricing?: { list: number; first: number | null; next: number | null; couponDuration: 'first' | 'forever' | null };
  } | null;
  /** The one billing state (README part 151). */
  access?: BillingAccess;
}

export default function SeoSubscriptionCard() {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await authFetch('/api/seo/subscription');
      setSt(r.ok ? await r.json() : null);
    } catch { setSt(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function call(path: string) {
    setBusy(true); setErr('');
    try {
      const r = await authFetch(path, { method: 'POST' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(body.error ?? 'משהו השתבש. נסו שוב.'); return; }
      if (body.redirectUrl) { window.location.href = body.redirectUrl; return; }
      if (typeof body.refunded === 'number' && body.refunded > 0) {
        setDone(`המנוי בוטל. ₪${fmt(body.refunded)} יוחזרו לאמצעי התשלום שלכם בימים הקרובים, ושלחנו לכם אישור במייל.`);
      }
      setConfirming(false);
      await load();
    } catch { setErr('משהו השתבש. נסו שוב.'); } finally { setBusy(false); }
  }

  if (!st) return null;
  const sub = st.subscription;
  // The ONE state (README part 151). An older server sends no `access`: derive it from the subscription.
  const access: BillingAccess = st.access ?? (sub
    ? {
      state: sub.status === 'past_due' ? 'past_due' : sub.status === 'canceled' ? 'none' : sub.cancelAtPeriodEnd ? 'canceled_until' : sub.cycle === 'year' ? 'annual' : 'monthly',
      until: sub.currentPeriodEnd, cycle: sub.cycle ?? 'month', renewalPending: sub.renewalPending, endedAt: sub.status === 'canceled' ? sub.currentPeriodEnd : null,
    }
    : { state: 'none', until: null, cycle: null });
  // Nothing to say while selling is closed and the account has nothing (no join button to offer).
  if (access.state === 'none' && !st.enabled && !sub) return null;

  // The plan's own price (the catalog carries all four), or what the coupon made the next charge.
  const planPrice = sub?.pricing?.next ?? st.catalog?.plans.find(p => p.id === sub?.planId)?.price ?? st.price;
  const copy = billingCopy(access, { price: planPrice, renews: sub?.renews });

  // The coupon, in one plain line: what was paid, and (for a first-payment coupon) the price from the next charge.
  const pr = sub?.pricing;
  let couponLine = '';
  if (sub && pr && pr.first !== null && sub.status !== 'canceled') {
    if (sub.cycle === 'year') couponLine = `שילמתם ₪${fmt(pr.first)} במקום ₪${fmt(pr.list)}, עם קוד הנחה.`;
    else if (pr.couponDuration === 'forever') couponLine = `עם קוד ההנחה אתם משלמים ₪${fmt(pr.first)} לחודש במקום ₪${fmt(pr.list)}, בכל חודש.`;
    else couponLine = `החודש הראשון עלה ₪${fmt(pr.first)} עם קוד הנחה. מהחיוב הבא: ₪${fmt(pr.next ?? pr.list)}.`;
  }
  const pl = sub && access.state !== 'grant' && access.state !== 'none' ? pageLine(sub.page) : '';
  const annualPlan = sub?.cycle === 'year';

  const paying = !!sub && (sub.status === 'active' || sub.status === 'past_due');
  const canRenew = !!sub && ((sub.status === 'past_due' && !sub.renewalPending) || sub.cancelAtPeriodEnd);
  const refund = sub?.refund?.eligible && sub.refund.amount ? sub.refund : null;
  // A paying subscriber always sees "ביטול המנוי". Inside the refund window the customer can still take the
  // refund even after a plain "stop renewal".
  const canCancel = paying && (!sub!.cancelAtPeriodEnd || !!refund);
  const refundUntil = refund ? dateHe(refund.until) : '';
  const confirmText = refund
    ? `לבטל? אתם בתוך 14 הימים מהתשלום הראשון, ולכן תקבלו החזר מלא של ₪${fmt(refund.amount as number)} לאמצעי התשלום. המנוי יסתיים מיד, הפוסטים והתשובות ייעצרו, ולא יהיו חיובים נוספים.`
    : annualPlan
      ? 'לבטל? הביטול מבטל חידוש בלבד, ואין החזר על חודשים שנותרו, בכפוף לזכויות הביטול שלכם לפי דין. הגישה תימשך עד סוף התקופה ששולמה.'
      : 'לבטל? לא יהיו חיובים נוספים והגישה תימשך עד סוף התקופה ששולמה. אין החזר על החודש שכבר שולם, בכפוף לזכויות הביטול שלכם לפי דין.';

  const btnPrimary = 'inline-flex min-h-[44px] items-center rounded-lg bg-[#2E63F6] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50';
  const btnSecondary = 'inline-flex min-h-[44px] items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col gap-3" data-billing-state={access.state}>
      <p className="text-xs font-medium text-slate-500">{st.planName}</p>
      <h3 className="text-base font-semibold text-slate-900">{copy.title}</h3>
      <p className="text-sm text-slate-700">{copy.line}</p>
      {couponLine && <p className="text-sm text-slate-600">{couponLine}</p>}
      {pl && <p className="text-sm text-slate-700">{pl}</p>}
      <p className="text-sm text-slate-500">{copy.after}</p>
      {refund && !confirming && (
        <p className="text-xs text-slate-500">ביטול עד {refundUntil}: החזר מלא של ₪{fmt(refund.amount as number)}.</p>
      )}
      {done && <p role="status" className="text-sm text-emerald-700">{done}</p>}
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {canRenew && st.enabled && (
          <button type="button" disabled={busy} onClick={() => call('/api/seo/subscription/start')} className={btnPrimary}>
            {sub!.status === 'past_due' ? 'עדכון כרטיס וחידוש' : 'חידוש המנוי'}
          </button>
        )}
        {access.state === 'none' && st.enabled && (
          <Link to="/seo-plan" className={btnPrimary}>{sub ? 'חידוש המנוי' : 'הצטרפות למנוי'}</Link>
        )}
        {access.state === 'grant' && (
          <Link to="/seo-plan" className={btnSecondary}>המסלולים והמחירים</Link>
        )}
        {access.state === 'annual' && (
          <Link to="/seo-plan" className={btnSecondary}>חידוש או שינוי תוכנית</Link>
        )}
        {canCancel && !confirming && (
          <button type="button" onClick={() => setConfirming(true)} className={btnSecondary}>
            ביטול המנוי
          </button>
        )}
        {canCancel && confirming && (
          <>
            <span className="text-sm text-slate-700">{confirmText}</span>
            <button type="button" disabled={busy} onClick={() => call('/api/seo/subscription/cancel')}
              className="inline-flex min-h-[44px] items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {refund ? 'כן, לבטל ולקבל החזר' : 'כן, לבטל'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={btnSecondary}>לא, להשאיר</button>
          </>
        )}
      </div>
    </div>
  );
}
