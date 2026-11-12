import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { authFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { LandoMark } from '../components/Lando';
import { PRICING, fmt } from '../config/pricing';
import { cycleUnit, pageLine, pickPlan, planLabel, type Catalog, type SeoCycle, type SeoPlanId } from '../lib/seoPlans';
import '../ui/ui-v3.css';

// /seo-plan — where a customer picks and starts a plan of the Google-promotion product:
// monthly or annual, with or without an included landing page (4 plans, docs/billing-spec.md §1).
// Everything shown comes from the server (plan name, the four plans and their prices, whether
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
interface Status { enabled: boolean; planName: string; price: number | null; subscription: Sub | null }
interface Plans extends Catalog { enabled: boolean; planName: string }

function dateHe(iso: string | null | undefined): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('he-IL'); } catch { return ''; }
}

export default function SeoPlan() {
  const { user, loading: authLoading } = useAuth();
  const [plans, setPlans] = useState<Plans | null>(null);
  const [st, setSt] = useState<Status | null>(null);
  const [hasProduct, setHasProduct] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cycle, setCycle] = useState<SeoCycle>('month');
  // Every plan includes a landing page (12.11.2026); there is no add-on to choose.
  const withPage = true;
  const [ack, setAck] = useState(false);
  const [payLink, setPayLink] = useState('');
  const [copied, setCopied] = useState(false);

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

  /** Opens a payment page for the chosen plan. `mode` 'go' redirects the browser; 'copy' only returns the link. */
  async function start(mode: 'go' | 'copy') {
    if (!plan) return;
    setBusy(true); setErr(''); setCopied(false);
    try {
      const r = await authFetch('/api/seo/subscription/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: plan.id }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(body.error ?? 'משהו השתבש. נסו שוב.'); return; }
      if (typeof body.redirectUrl !== 'string' || !body.redirectUrl) { setErr('משהו השתבש. נסו שוב.'); return; }
      if (mode === 'go') { window.location.assign(body.redirectUrl); return; }
      setPayLink(body.redirectUrl);
      try { await navigator.clipboard.writeText(body.redirectUrl); setCopied(true); } catch { /* the field below can be copied by hand */ }
    } catch { setErr('משהו השתבש. נסו שוב.'); } finally { setBusy(false); }
  }

  const sub = st?.subscription ?? null;
  const active = sub?.status === 'active' && !sub.cancelAtPeriodEnd;
  const enabled = plans?.enabled ?? st?.enabled ?? false;
  const dash = <Link to="/dashboard" className="uv3-btn" style={{ marginTop: 16 }}>לדשבורד</Link>;

  let body: React.ReactNode;
  if (authLoading || !loaded) {
    body = <p className="uv3-sub" style={{ color: 'var(--u-muted)' }} aria-busy="true">טוענים…</p>;
  } else if (!plans) {
    body = <p>לא הצלחנו לטעון את פרטי התוכניות. נסו לרענן את הדף.</p>;
  } else if (!enabled) {
    body = <p>המנוי עדיין לא נפתח. נעדכן כשיהיה אפשר להצטרף.</p>;
  } else if (user && active && sub) {
    const end = dateHe(sub.currentPeriodEnd);
    const label = sub.cycle ? planLabel(sub.cycle, !!sub.withPage) : 'המנוי';
    const pl = pageLine(sub.page);
    body = (
      <>
        <p><strong>{label} פעיל.</strong>{end ? (sub.renews === false ? ` תקף עד ${end}, ולא מתחדש אוטומטית.` : ` החיוב הבא ב-${end}.`) : ''}</p>
        {pl && <p style={{ marginTop: 8 }}>{pl}</p>}
        {dash}
      </>
    );
  } else if (user && hasProduct && !sub) {
    body = (<><p>המוצר כבר פעיל בחשבון שלכם, ואין צורך במנוי.</p>{dash}</>);
  } else {
    const price = plan?.price ?? 0;
    body = (
      <>
        <fieldset className="uv3-fieldset" style={{ marginTop: 0 }}>
          <legend>תקופת תשלום</legend>
          <div className="uv3-opts">
            <label className="uv3-opt">
              <input type="radio" name="cycle" checked={!annual} onChange={() => { setCycle('month'); setAck(false); }} />
              <span className="uv3-opt-body"><span className="uv3-opt-title">חודשי</span><span className="uv3-opt-sub">מתחדש בכל חודש, מבטלים בכל רגע.</span></span>
            </label>
            <label className="uv3-opt">
              <input type="radio" name="cycle" checked={annual} onChange={() => setCycle('year')} />
              <span className="uv3-opt-body">
                <span className="uv3-opt-title">שנתי</span>
                <span className="uv3-opt-sub">תשלום אחד לשנה, לא מתחדש אוטומטית.</span>
                {pickPlan(plans, 'year', withPage)?.savingVsMonthly ? <span className="uv3-badge">חוסכים <bdi>₪{fmt(pickPlan(plans, 'year', withPage)!.savingVsMonthly)}</bdi> בשנה</span> : null}
              </span>
            </label>
          </div>
        </fieldset>

        {plan && (
          <div className="uv3-sum" aria-live="polite">
            <p className="uv3-sum-price">₪{fmt(price)} <small>{cycleUnit(cycle)}, כולל מע״מ</small></p>
            {annual && <p className="uv3-opt-sub" style={{ marginTop: 4 }}>זה בערך <bdi>₪{fmt(Math.round(plan.pricePerMonth))}</bdi> לחודש. משלמים על 10 חודשים במקום 12.</p>}
            <ul className="uv3-checks">
              <li>בדיקת כרטיס העסק שלכם בגוגל מפות והשוואה לעסקים דומים באזור.</li>
              <li>קישור וקוד QR לביקורות, וקוד להצגת הביקורות באתר.</li>
              <li>פוסט שבועי בכרטיס העסק ותשובות לביקורות, שאנחנו כותבים ומפרסמים בשבילכם.</li>
              <li>דף נחיתה לעסק ודפים לחיפושים של לקוחות באזור שלכם, כלולים במנוי כל עוד הוא פעיל.</li>
              <li>דוח חודשי: מה עשינו, וכמה פניות הגיעו.</li>
            </ul>
          </div>
        )}

        <div className="uv3-terms">
          {annual ? (
            <>
              <p>חיוב אחד לתקופה של 12 חודשים. המנוי לא מתחדש אוטומטית ופג בתאריך הסיום שלו; נשלח תזכורת כ-14 יום לפני כן. ביטול מנוי שנתי מבטל חידוש בלבד, בלי החזר על חודשים שנותרו, והגישה נשארת עד סוף התקופה ששולמה.</p>
            </>
          ) : (
            <p>המנוי מתחדש אוטומטית בכל חודש. אפשר לבטל בכל רגע מהדשבורד, והגישה נשארת עד סוף התקופה ששולמה.</p>
          )}
          {withPage && (
            <p style={{ marginTop: 6 }}>ביטול המנוי מקפיא את הדף (הוא יורד מהאוויר, והתוכן והפניות נשמרים) עד שתחדשו. דף נוסף נקנה בנפרד, במחיר דף בודד (<bdi>₪{fmt(PRICING.singlePage.price)}</bdi>).</p>
          )}
          <p style={{ marginTop: 6 }}>התשלום מתבצע בעמוד מאובטח של SUMIT. פרטים מלאים ב<Link to="/terms" style={{ textDecoration: 'underline' }}>תנאי השימוש</Link>.</p>
        </div>

        {annual && (
          <label className="uv3-ack">
            <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
            <span>קראתי והבנתי: ביטול מנוי שנתי מבטל חידוש בלבד, ואין החזר על חודשים שנותרו.</span>
          </label>
        )}

        {err && <p className="uv3-err" role="alert">{err}</p>}
        {user ? (
          <>
            <button type="button" className="uv3-btn uv3-btn-block" disabled={busy || !plan || (annual && !ack)} onClick={() => start('go')}>
              {busy ? 'פותחים תשלום…' : sub ? 'חידוש המנוי' : `מעבר לתשלום${plan ? ` · ₪${fmt(plan.price)}` : ''}`}
            </button>
            <button type="button" className="uv3-btn uv3-btn-ghost uv3-btn-block" style={{ marginTop: 10 }} disabled={busy || !plan || (annual && !ack)} onClick={() => start('copy')}>
              העתקת קישור לתשלום
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
          <p className="uv3-sub">בוחרים תקופה ואם רוצים דף נחיתה, ורואים מיד כמה זה עולה.</p>
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
