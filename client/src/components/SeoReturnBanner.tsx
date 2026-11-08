import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authFetch } from '../lib/api';
import { planLabel, type SeoCycle } from '../lib/seoPlans';

// The screen a customer lands on after SUMIT's payment page: the server redirects to
// /dashboard?seo_subscription=ok|review|cancel|error (GET /api/seo/subscription/return, which has
// already checked the payment with SUMIT before saying "ok"). Shown on top of the dashboard
// whatever the view, in plain words, with ONE next step. "ok" is confirmed against the
// subscription itself before it says the plan is active; "review" keeps checking for a short while,
// because the confirmation can still arrive from SUMIT after the browser came back.

type Outcome = 'ok' | 'review' | 'cancel' | 'error';
const KNOWN: Outcome[] = ['ok', 'review', 'cancel', 'error'];

interface SubInfo { status: string; currentPeriodEnd: string | null; cycle?: SeoCycle; withPage?: boolean; renews?: boolean }

function readOutcome(): Outcome | null {
  try {
    const v = new URLSearchParams(window.location.search).get('seo_subscription');
    return KNOWN.includes(v as Outcome) ? (v as Outcome) : null;
  } catch { return null; }
}

function dateHe(iso: string | null): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('he-IL'); } catch { return ''; }
}

const POLLS = 5;
const POLL_MS = 3000;

export default function SeoReturnBanner() {
  const [outcome, setOutcome] = useState<Outcome | null>(readOutcome);
  const [sub, setSub] = useState<SubInfo | null>(null);
  const [checking, setChecking] = useState(outcome === 'ok' || outcome === 'review');
  const active = sub?.status === 'active';

  useEffect(() => {
    if (outcome !== 'ok' && outcome !== 'review') return;
    let alive = true;
    (async () => {
      for (let i = 0; i < POLLS && alive; i++) {
        try {
          const r = await authFetch('/api/seo/subscription');
          const b = r.ok ? await r.json() : null;
          if (!alive) return;
          if (b?.subscription) setSub(b.subscription);
          if (b?.subscription?.status === 'active') break;
        } catch { /* try again */ }
        await new Promise(res => setTimeout(res, POLL_MS));
      }
      if (alive) setChecking(false);
    })();
    return () => { alive = false; };
  }, [outcome]);

  function dismiss() {
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('seo_subscription');
      window.history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
    } catch { /* leave the address as is */ }
    setOutcome(null);
    try { window.scrollTo({ top: 0 }); } catch { /* no scrolling */ }
  }

  if (!outcome) return null;

  const box = 'rounded-2xl border p-5 flex flex-col gap-3';
  const btn = 'inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#2E63F6] px-5 text-sm font-bold text-white hover:bg-[#2552d0]';
  const btn2 = 'inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50';

  if ((outcome === 'ok' || outcome === 'review') && !active) {
    return (
      <section role="status" className={`${box} border-slate-200 bg-white`}>
        <h2 className="text-base font-bold text-slate-900">{checking ? 'מאשרים את התשלום…' : 'לא הצלחנו לאשר את התשלום אוטומטית'}</h2>
        <p className="text-sm leading-relaxed text-slate-700">
          {checking
            ? 'זה לוקח כמה שניות. אין צורך לשלם שוב.'
            : 'אם חויבתם, אל תשלמו שוב: נבדוק ונעדכן אתכם. אם לא חויבתם, אפשר לנסות שוב.'}
        </p>
        {!checking && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={dismiss} className={btn2}>סגירה</button>
            <Link to="/seo-plan" className={btn2}>חזרה לבחירת תוכנית</Link>
          </div>
        )}
      </section>
    );
  }

  if (outcome === 'ok' || outcome === 'review') {
    const end = dateHe(sub?.currentPeriodEnd ?? null);
    const label = sub?.cycle ? planLabel(sub.cycle, !!sub.withPage) : 'המנוי';
    return (
      <section role="status" className={`${box} border-emerald-200 bg-emerald-50`}>
        <h2 className="text-base font-bold text-emerald-900">התשלום התקבל, {label} פעיל</h2>
        <p className="text-sm leading-relaxed text-emerald-900">
          {end ? (sub?.renews === false ? `המנוי תקף עד ${end} ולא מתחדש אוטומטית. ` : `החיוב הבא ב-${end}. `) : ''}
          הצעד הבא: להשלים את ההקמה, כדי שנתחיל לעבוד על הכרטיס שלכם.
        </p>
        <div><button type="button" onClick={dismiss} className={btn}>המשך להקמה</button></div>
      </section>
    );
  }

  if (outcome === 'cancel') {
    return (
      <section role="status" className={`${box} border-slate-200 bg-white`}>
        <h2 className="text-base font-bold text-slate-900">התשלום בוטל, לא חויבתם</h2>
        <p className="text-sm text-slate-700">אפשר לחזור לבחירת התוכנית ולנסות שוב מתי שנוח.</p>
        <div className="flex flex-wrap gap-2">
          <Link to="/seo-plan" className={btn}>חזרה לבחירת תוכנית</Link>
          <button type="button" onClick={dismiss} className={btn2}>סגירה</button>
        </div>
      </section>
    );
  }

  return (
    <section role="alert" className={`${box} border-rose-200 bg-rose-50`}>
      <h2 className="text-base font-bold text-rose-900">משהו השתבש בחזרה מהתשלום</h2>
      <p className="text-sm leading-relaxed text-rose-900">אם חויבתם, אל תשלמו שוב: נבדוק ונעדכן אתכם. אם לא חויבתם, אפשר לנסות שוב.</p>
      <div className="flex flex-wrap gap-2">
        <Link to="/seo-plan" className={btn}>חזרה לבחירת תוכנית</Link>
        <button type="button" onClick={dismiss} className={btn2}>סגירה</button>
      </div>
    </section>
  );
}
