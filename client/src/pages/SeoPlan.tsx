import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';

// /seo-plan — where a customer starts the monthly plan of the Google-promotion product.
// Everything shown comes from the server (plan name, price, whether the plan is open); nothing
// here can charge anyone: the button only asks the server to open SUMIT's payment page, and the
// subscription is activated by the server after it has verified the payment with SUMIT.

interface Status {
  enabled: boolean;
  planName: string;
  price: number | null;
  subscription: { status: 'active' | 'past_due' | 'canceled'; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
}

export default function SeoPlan() {
  const { user, loading: authLoading } = useAuth();
  const [st, setSt] = useState<Status | null>(null);
  const [hasProduct, setHasProduct] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { document.title = 'קידום העסק בגוגל | Pagey'; }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    let alive = true;
    (async () => {
      try {
        const [s, p] = await Promise.all([authFetch('/api/seo/subscription'), authFetch('/api/users/plan')]);
        if (!alive) return;
        setSt(s.ok ? await s.json() : null);
        if (p.ok) { const b = await p.json(); setHasProduct(b?.status?.entitlements?.seo_autopilot === true); }
      } catch { /* shown as "could not load" */ }
      if (alive) setLoaded(true);
    })();
    return () => { alive = false; };
  }, [authLoading, user]);

  async function start() {
    setBusy(true); setErr('');
    try {
      const r = await authFetch('/api/seo/subscription/start', { method: 'POST' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(body.error ?? 'משהו השתבש. נסו שוב.'); return; }
      if (body.redirectUrl) { window.location.href = body.redirectUrl; return; }
      setErr('משהו השתבש. נסו שוב.');
    } catch { setErr('משהו השתבש. נסו שוב.'); } finally { setBusy(false); }
  }

  const sub = st?.subscription ?? null;
  const active = sub?.status === 'active' && !sub.cancelAtPeriodEnd;
  const price = st?.price ?? null;

  let body: React.ReactNode;
  if (authLoading || (user && !loaded)) {
    body = <p className="text-sm text-slate-500" aria-busy="true">טוענים…</p>;
  } else if (!user) {
    body = (
      <>
        <p className="text-slate-700">כדי להתחיל מנוי צריך להתחבר או להירשם.</p>
        <Link to="/login?next=/seo-plan" className="mt-4 inline-flex min-h-[44px] items-center rounded-lg bg-[#2E63F6] px-5 text-sm font-semibold text-white hover:opacity-90">כניסה או הרשמה</Link>
      </>
    );
  } else if (!st) {
    body = <p className="text-sm text-slate-700">לא הצלחנו לטעון את פרטי המנוי. נסו לרענן את הדף.</p>;
  } else if (!st.enabled) {
    body = <p className="text-slate-700">המנוי החודשי עדיין לא נפתח. נעדכן כשיהיה אפשר להצטרף.</p>;
  } else if (active) {
    body = (
      <>
        <p className="text-slate-700">המנוי שלכם פעיל.</p>
        <Link to="/dashboard" className="mt-4 inline-flex min-h-[44px] items-center rounded-lg bg-[#2E63F6] px-5 text-sm font-semibold text-white hover:opacity-90">לדשבורד</Link>
      </>
    );
  } else if (hasProduct && !sub) {
    body = (
      <>
        <p className="text-slate-700">המוצר כבר פעיל בחשבון שלכם, ואין צורך במנוי.</p>
        <Link to="/dashboard" className="mt-4 inline-flex min-h-[44px] items-center rounded-lg bg-[#2E63F6] px-5 text-sm font-semibold text-white hover:opacity-90">לדשבורד</Link>
      </>
    );
  } else {
    body = (
      <>
        <p className="text-3xl font-bold text-slate-900">₪{price} <span className="text-base font-medium text-slate-500">לחודש, כולל מע״מ</span></p>
        <ul className="mt-4 flex flex-col gap-1.5 text-sm text-slate-700">
          <li>בדיקת כרטיס העסק שלכם בגוגל מפות והשוואה לעסקים דומים באזור.</li>
          <li>קישור וקוד QR לביקורות, וקוד להצגת הביקורות באתר.</li>
          <li>דפי נחיתה לשירותים, ערכות תוכן ומעקב פניות במקום אחד.</li>
        </ul>
        <p className="mt-4 text-xs text-slate-500">המנוי מתחדש אוטומטית בכל חודש. אפשר לבטל בכל רגע מהדשבורד, והגישה נשארת עד סוף התקופה ששולמה. התשלום מתבצע בעמוד מאובטח של SUMIT.</p>
        {err && <p className="mt-3 text-sm text-red-600" role="alert">{err}</p>}
        <button type="button" disabled={busy} onClick={start} className="mt-4 inline-flex min-h-[44px] items-center rounded-lg bg-[#2E63F6] px-5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {busy ? 'פותחים תשלום…' : sub ? 'חידוש המנוי' : 'התחלת מנוי ומעבר לתשלום'}
        </button>
      </>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-bold text-[#0E2148]">Pagey</Link>
          {user && <Link to="/dashboard" className="text-sm text-slate-600 hover:underline">לדשבורד</Link>}
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-8">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h1 className="mb-3 text-xl font-bold text-slate-900">{st?.planName ?? 'קידום העסק בגוגל'}</h1>
          {body}
        </div>
        <p className="mt-4 text-center text-xs text-slate-500"><Link to="/terms" className="hover:underline">תנאי שימוש</Link> · <Link to="/privacy" className="hover:underline">פרטיות</Link></p>
      </main>
    </div>
  );
}
