import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { authFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { LandoMark } from '../components/Lando';
import CouponField, { type CouponQuote } from '../components/CouponField';
import { fmt } from '../config/pricing';
import {
  CHECKOUT_TIMEOUT_MS, CHECKOUT_TIMEOUT_TEXT, billingCopy, checkoutPhaseText, minChargeNote, type BillingAccess,
} from '../lib/billingState';
import { cycleUnit, pageLine, pickPlan, type Catalog, type SeoCycle, type SeoPlanId } from '../lib/seoPlans';
import '../ui/ui-v3.css';

// /seo-plan — where a customer picks and starts a plan of the Google-promotion product:
// monthly or annual; the landing page is included in both (12.11.2026).
// Everything shown comes from the server (plan name, the plans and their prices, whether
// selling is open); no price is typed here. Nothing here can charge anyone: the button only asks
// the server to open SUMIT's payment page for the chosen plan id, and the subscription is
// activated by the server after it has verified the payment with SUMIT.

interface Sub {
  status: 'active' | 'past_due' | 'canceled';
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  planId?: SeoPlanId;
  cycle?: SeoCycle;
  withPage?: boolean;
  renews?: boolean;
  page?: { included: boolean; pageId: string | null; status: string | null };
}
interface Status { enabled: boolean; testMode?: boolean; planName: string; price: number | null; subscription: Sub | null; access?: BillingAccess }
interface Plans extends Catalog { enabled: boolean; planName: string }

export default function SeoPlan() {
  const { user, loading: authLoading } = useAuth();
  const [plans, setPlans] = useState<Plans | null>(null);
  const [st, setSt] = useState<Status | null>(null);
  const [hasProduct, setHasProduct] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  // While the server opens SUMIT's page: the progressive text (README part 151, it can take seconds).
  const [phase, setPhase] = useState('');
  const phaseTimer = useRef<number | null>(null);
  useEffect(() => () => { if (phaseTimer.current) window.clearInterval(phaseTimer.current); }, []);
  const [err, setErr] = useState('');
  const [cycle, setCycle] = useState<SeoCycle>('month');
  // Every plan includes a landing page (12.11.2026); there is no add-on to choose.
  const withPage = true;
  const [ack, setAck] = useState(false);
  const [payLink, setPayLink] = useState('');
  const [copied, setCopied] = useState(false);
  // A discount code the server priced for the chosen plan (a PREVIEW: the server re-checks and prices it again
  // at checkout). Keyed by plan id, so a quote for the monthly plan is never shown against the annual one.
  const [coupon, setCoupon] = useState<{ code: string; quotes: Record<string, CouponQuote> } | null>(null);

  useEffect(() => { document.title = 'קידום העסק בגוגל | Pagey'; }, []);

  useEffect(() => {
    if (authLoading) return;
    let alive = true;
    (async () => {
      try {
        const reqs: Promise<Response>[] = [fetch('/api/seo/plans')];
        if (user) reqs.push(authFetch('/api/seo/subscription'), authFetch('/api/users/plan'));
        const [pl, s, p] = await Promise.all(reqs);
        if (!alive) return;
        setPlans(pl.ok ? await pl.json() : null);
        if (s) setSt(s.ok ? await s.json() : null);
        if (p?.ok) { const b = await p.json(); setHasProduct(b?.status?.entitlements?.seo_autopilot === true); }
      } catch { /* shown as "could not load" */ }
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
  }, [authLoading, user]);

  const plan = pickPlan(plans, cycle, withPage);
  const annual = cycle === 'year';
  const quote = plan && coupon ? coupon.quotes[plan.id] ?? null : null;
  const chooseCycle = (c: SeoCycle) => { setCycle(c); setCoupon(null); if (c === 'month') setAck(false); };

  /** Opens a payment page for the chosen plan. `mode` 'go' redirects the browser; 'copy' only returns the link. */
  async function start(mode: 'go' | 'copy') {
    if (!plan) return;
    setBusy(true); setErr(''); setCopied(false);
    const t0 = Date.now();
    let leaving = false;   // the browser is on its way to SUMIT: keep the button busy
    setPhase(checkoutPhaseText(0));
    phaseTimer.current = window.setInterval(() => setPhase(checkoutPhaseText(Date.now() - t0)), 500);
    // The server gives up on SUMIT at 20 s; the browser waits a little longer, then offers a retry.
    const ctrl = new AbortController();
    const giveUp = window.setTimeout(() => ctrl.abort(), CHECKOUT_TIMEOUT_MS);
    const stop = () => { window.clearTimeout(giveUp); if (phaseTimer.current) { window.clearInterval(phaseTimer.current); phaseTimer.current = null; } };
    try {
      const r = await authFetch('/api/seo/subscription/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ plan: plan.id, ...(quote && coupon ? { couponCode: coupon.code } : {}) }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(body.error ?? 'משהו השתבש. נסו שוב.'); return; }
      if (typeof body.redirectUrl !== 'string' || !body.redirectUrl) { setErr('משהו השתבש. נסו שוב.'); return; }
      if (mode === 'go') { leaving = true; stop(); setPhase('עוברים לעמוד התשלום המאובטח…'); window.location.assign(body.redirectUrl); return; }
      setPayLink(body.redirectUrl);
      try { await navigator.clipboard.writeText(body.redirectUrl); setCopied(true); } catch { /* the field below can be copied by hand */ }
    } catch (e) {
      setErr(ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError') ? CHECKOUT_TIMEOUT_TEXT : 'משהו השתבש. נסו שוב.');
    } finally { stop(); if (!leaving) { setBusy(false); setPhase(''); } }
  }

  const sub = st?.subscription ?? null;
  const enabled = plans?.enabled ?? st?.enabled ?? false;
  // The ONE billing state (README part 151). Older servers send no `access`: derive the two cases they knew.
  const access: BillingAccess | null = st?.access
    ?? (sub?.status === 'active' && !sub.cancelAtPeriodEnd ? { state: sub.cycle === 'year' ? 'annual' : 'monthly', until: sub.currentPeriodEnd, cycle: sub.cycle ?? 'month' }
      : hasProduct && !sub ? { state: 'grant', until: null, cycle: null } : null);
  const note = quote ? minChargeNote(quote, cycle) : null;

  let body: React.ReactNode;
  if (authLoading || !loaded) {
    body = <p className="uv3-sub" style={{ color: 'var(--u-muted)' }} aria-busy="true">טוענים…</p>;
  } else if (!plans) {
    body = <p>לא הצלחנו לטעון את פרטי התוכניות. נסו לרענן את הדף.</p>;
  } else if (!enabled) {
    body = <p>המנוי עדיין לא נפתח. נעדכן כשיהיה אפשר להצטרף.</p>;
  } else if (user && access && (access.state === 'monthly' || access.state === 'annual' || access.state === 'grant')) {
    // Paying, or access given by hand: the same words as the settings card (lib/billingState.ts).
    const planPrice = sub?.planId ? plans.plans.find(p => p.id === sub.planId)?.price ?? null : null;
    const c = billingCopy(access, { price: planPrice, renews: sub?.renews });
    const pl = access.state !== 'grant' ? pageLine(sub?.page) : '';
    body = (
      <>
        <p><strong>{c.title}.</strong> {c.line}</p>
        {pl && <p style={{ marginTop: 8 }}>{pl}</p>}
        <p className="uv3-opt-sub" style={{ marginTop: 8 }}>{c.after}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
          <Link to="/dashboard" className="uv3-btn">לדשבורד</Link>
          {c.action === 'cancel' && <Link to="/dashboard?area=settings" className="uv3-btn uv3-btn-ghost">ניהול המנוי וביטול</Link>}
        </div>
      </>
    );
  } else {
    const price = plan?.price ?? 0;
    body = (
      <>
        <fieldset className="uv3-fieldset" style={{ marginTop: 0 }}>
          <legend>תקופת תשלום</legend>
          <div className="uv3-opts">
            {/* The whole card is the label: the radio is visually hidden inside it, so a click (or tap) anywhere
                on the card, the word "שנתי" included, selects it (QA 23.11). */}
            <label className="uv3-opt">
              <input type="radio" name="cycle" value="month" checked={!annual} onChange={() => chooseCycle('month')} />
              <span className="uv3-opt-body"><span className="uv3-opt-dot" aria-hidden /><span className="uv3-opt-title">חודשי</span><span className="uv3-opt-sub">מתחדש בכל חודש, מבטלים בכל רגע.</span></span>
            </label>
            <label className="uv3-opt">
              <input type="radio" name="cycle" value="year" checked={annual} onChange={() => chooseCycle('year')} />
              <span className="uv3-opt-body">
                <span className="uv3-opt-dot" aria-hidden />
                <span className="uv3-opt-title">שנתי</span>
                <span className="uv3-opt-sub">תשלום אחד לשנה, לא מתחדש אוטומטית.</span>
                {pickPlan(plans, 'year', withPage)?.savingVsMonthly ? <span className="uv3-badge">חוסכים <bdi>₪{fmt(pickPlan(plans, 'year', withPage)!.savingVsMonthly)}</bdi> בשנה</span> : null}
              </span>
            </label>
          </div>
        </fieldset>

        {plan && (
          <div className="uv3-sum" aria-live="polite">
            {quote ? (
              <>
                <p className="uv3-sum-price">
                  ₪{fmt(quote.finalAmount)}{' '}
                  <s style={{ color: 'var(--u-muted)', fontSize: '0.6em', fontWeight: 500 }} aria-label={`במקום ₪${fmt(price)}`}>₪{fmt(price)}</s>
                  <small style={{ display: 'block', marginTop: 4 }}>
                    {note ? note.priceLabel : <>{annual ? 'לשנה הראשונה' : quote.seoDuration === 'forever' ? cycleUnit(cycle) : 'לחודש הראשון'}, כולל מע״מ</>}
                  </small>
                </p>
                <p className="uv3-opt-sub" style={{ marginTop: 6, color: 'var(--u-ink)' }}>
                  {note && <>{note.explain} </>}
                  {note && annual ? null : annual
                    ? <>עם קוד ההנחה משלמים <bdi>₪{fmt(quote.finalAmount)}</bdi> על השנה במקום <bdi>₪{fmt(price)}</bdi>.</>
                    : quote.seoDuration === 'forever'
                      ? <>ההנחה חלה על כל החיובים החודשיים, כל עוד המנוי פעיל.</>
                      : <>ההנחה חלה על החודש הראשון. מהחיוב הבא: <bdi>₪{fmt(quote.recurringAmount ?? price)}</bdi> לחודש.</>}
                </p>
              </>
            ) : (
              <p className="uv3-sum-price">₪{fmt(price)} <small>{cycleUnit(cycle)}, כולל מע״מ</small></p>
            )}
            {annual && !quote && <p className="uv3-opt-sub" style={{ marginTop: 4 }}>זה בערך <bdi>₪{fmt(Math.round(plan.pricePerMonth))}</bdi> לחודש. משלמים על 10 חודשים במקום 12.</p>}
            <ul className="uv3-checks">
              <li>כל שבוע אנחנו כותבים ומפרסמים פוסט בכרטיס העסק שלכם.</li>
              <li>עונים בשבילכם לביקורות טובות; לביקורת שלילית מכינים טיוטה לאישורכם.</li>
              <li>דף נחיתה ודפים לחיפושים באזור שלכם, כלולים במנוי כל עוד הוא פעיל.</li>
              <li>דוח חודשי: מה עשינו ואיך הגיעו הפניות.</li>
              <li>ערכה לבקשת ביקורות (קישור, QR והודעת וואטסאפ), ובדיקה של הכרטיס מול עסקים דומים באזור.</li>
            </ul>
          </div>
        )}

        {/* "יש לכם קוד הנחה?": a clear secondary control. Not for test accounts: their test price wins over any code. */}
        {user && plan && !st?.testMode && (
          <CouponField
            purpose={annual ? 'seo_annual' : 'seo_monthly'}
            references={[plan.id]}
            onChange={setCoupon}
            collapsible
            className="uv3-coupon"
          />
        )}

        <div className="uv3-terms">
          {annual ? (
            <>
              <p>חיוב אחד לתקופה של 12 חודשים. המנוי לא מתחדש אוטומטית ופג בתאריך הסיום שלו; נשלח תזכורת כ-14 יום לפני כן. ביטול תוך 14 יום מהתשלום הראשון: החזר מלא, והמנוי מסתיים מיד. אחרי 14 יום ביטול מבטל חידוש בלבד, ואין החזר על חודשים שנותרו, בכפוף לזכויות הביטול לפי דין. הגישה נשארת עד סוף התקופה ששולמה.</p>
            </>
          ) : (
            <p>המנוי מתחדש אוטומטית בכל חודש. ביטול תוך 14 יום מהתשלום הראשון: החזר מלא, והמנוי מסתיים מיד. החזר מלא ניתן פעם אחת בלבד לחשבון, ורק על התשלום הראשון ולא על חידושים. אחרי 14 יום אפשר לבטל בכל רגע מהדשבורד, והגישה נשארת עד סוף התקופה ששולמה, בכפוף לזכויות הביטול לפי דין.</p>
          )}
          {withPage && (
            <p style={{ marginTop: 6 }}>דף הנחיתה של העסק כלול. כשהמנוי מסתיים הדף יורד מהאוויר, והתוכן והפניות נשמרים עד שתחדשו. דפי נחיתה נוספים, למבצע או לשירות אחר, נקנים בנפרד.</p>
          )}
          {quote && (
            <p style={{ marginTop: 6 }}>קוד ההנחה חל כפי שמתואר כאן. החזר בתוך 14 הימים הוא על הסכום ששילמתם בפועל.</p>
          )}
          <p style={{ marginTop: 6 }}>התשלום מתבצע בעמוד מאובטח של SUMIT. פרטים מלאים ב<Link to="/terms" style={{ textDecoration: 'underline' }}>תנאי השימוש</Link>.</p>
        </div>

        {annual && (
          <label className="uv3-ack">
            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
            <span>קראתי והבנתי: ביטול תוך 14 יום מהתשלום הראשון מזכה בהחזר מלא. אחרי כן ביטול מנוי שנתי מבטל חידוש בלבד, ואין החזר על חודשים שנותרו, בכפוף לזכויות הביטול לפי דין.</span>
          </label>
        )}

        {err && <p className="uv3-err" role="alert">{err}</p>}
        {user ? (
          <>
            <button type="button" className="uv3-btn uv3-btn-block" disabled={busy || !plan || (annual && !ack)} onClick={() => start('go')}>
              {busy ? (phase || checkoutPhaseText(0)) : sub ? 'חידוש המנוי' : note ? note.button : `מעבר לתשלום${plan ? ` · ₪${fmt(quote ? quote.finalAmount : plan.price)}` : ''}`}
            </button>
            {busy && phase && <p className="uv3-opt-sub" role="status" aria-live="polite" style={{ marginTop: 6, textAlign: 'center' }}>{phase === checkoutPhaseText(0) ? 'זה לוקח בדרך כלל כמה שניות.' : 'אפשר להמתין, לא בוצע שום חיוב עד שתאשרו בעמוד התשלום.'}</p>}
            {/* Paying from another device: a quiet text link, not a second big button next to the payment. */}
            <button type="button" disabled={busy || !plan || (annual && !ack)} onClick={() => start('copy')}
              style={{ marginTop: 10, minHeight: 44, width: '100%', background: 'none', border: 0, color: 'var(--u-muted)', fontSize: 13, textDecoration: 'underline', cursor: 'pointer' }}>
              רוצים לשלם ממכשיר אחר? העתקת קישור לתשלום
            </button>
            {payLink && (
              <div className="uv3-terms" role="status">
                <p>{copied ? 'הקישור הועתק. ' : 'העתיקו את הקישור: '}הוא פותח את עמוד התשלום של התוכנית שבחרתם, אפשר לפתוח אותו מכל מכשיר.</p>
                <input readOnly dir="ltr" value={payLink} onFocus={e => e.currentTarget.select()} aria-label="קישור לתשלום"
                  style={{ marginTop: 6, width: '100%', minHeight: 44, padding: '0 10px', border: '1px solid var(--u-line)', borderRadius: 10, background: '#fff', fontSize: 13 }} />
              </div>
            )}
          </>
        ) : (
          <Link to="/login?next=/seo-plan" className="uv3-btn uv3-btn-block">כניסה או הרשמה כדי להמשיך</Link>
        )}
      </>
    );
  }

  return (
    <div dir="rtl" className="uv3">
      <div className="uv3-bar">
        <Link to="/" className="uv3-brand"><LandoMark size={26} /><span>Pagey</span></Link>
        {user && <Link to="/dashboard" className="uv3-back">לדשבורד <ArrowLeft size={15} aria-hidden /></Link>}
      </div>
      <main className="uv3-main">
        <header className="uv3-hero">
          <h1>{plans?.planName ?? st?.planName ?? 'קידום העסק בגוגל'}</h1>
          <p className="uv3-sub">מנוי אחד, חודשי או שנתי. דף הנחיתה כלול.</p>
        </header>
        <div className="uv3-card">{body}</div>
        <nav className="uv3-nav" aria-label="מסמכים משפטיים">
          <Link to="/terms">תנאי שימוש</Link>
          <Link to="/privacy">פרטיות</Link>
        </nav>
      </main>
    </div>
  );
}
