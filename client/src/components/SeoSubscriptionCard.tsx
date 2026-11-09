import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authFetch } from '../lib/api';
import { fmt } from '../config/pricing';
import { pageLine, planLabel, type Catalog, type SeoCycle, type SeoPlanId } from '../lib/seoPlans';

// The monthly plan of the Google-promotion product. Shows nothing while the feature is off
// (server flag) or while the account has no subscription of its own (a manually granted
// account is not asked to pay). Cancelling keeps access to the end of the paid period.

interface Status {
  enabled: boolean;
  planName: string;
  price: number | null;
  catalog?: Catalog;
  subscription: {
    status: 'active' | 'past_due' | 'canceled'; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean;
    planId?: SeoPlanId; cycle?: SeoCycle; withPage?: boolean; renews?: boolean;
    page?: { included: boolean; pageId: string | null; status: string | null };
  } | null;
}

function dateHe(iso: string | null): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('he-IL'); } catch { return ''; }
}

export default function SeoSubscriptionCard() {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState('');

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
      setConfirming(false);
      await load();
    } catch { setErr('משהו השתבש. נסו שוב.'); } finally { setBusy(false); }
  }

  const sub = st?.subscription;
  if (!st || !sub) return null;

  const end = dateHe(sub.currentPeriodEnd);
  let line: string;
  if (sub.status === 'canceled') line = `המנוי הסתיים${end ? ` ב-${end}` : ''}.`;
  else if (sub.cancelAtPeriodEnd) line = `המנוי בוטל ולא יחודש. הגישה נשארת עד ${end}.`;
  else if (sub.status === 'past_due') line = 'החיוב האחרון לא עבר. כדי להמשיך ללא הפסקה, הזינו כרטיס מחדש.';
  else if (sub.renews === false) line = `המנוי השנתי פעיל${end ? ` ותקף עד ${end}` : ''}, ולא מתחדש אוטומטית. נשלח תזכורת לפני שהוא מסתיים.`;
  else {
    // The plan's own price (the catalog carries all four), not the base monthly price.
    const planPrice = st.catalog?.plans.find(p => p.id === sub.planId)?.price ?? st.price;
    line = `המנוי פעיל${end ? ` ועד ${end}` : ''}, ומתחדש כל חודש${planPrice ? ` ב-₪${fmt(planPrice)}` : ''}.`;
  }
  const kind = sub.cycle ? planLabel(sub.cycle, !!sub.withPage) : '';
  const pl = pageLine(sub.page);
  const annualPlan = sub.cycle === 'year';

  const canRenew = sub.status === 'past_due' || sub.status === 'canceled' || sub.cancelAtPeriodEnd;
  const canCancel = (sub.status === 'active' || sub.status === 'past_due') && !sub.cancelAtPeriodEnd;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col gap-3">
      <h3 className="text-base font-semibold text-slate-900">{st.planName}, המנוי שלכם</h3>
      {kind && <p className="text-xs font-medium text-slate-500">{kind}</p>}
      <p className="text-sm text-slate-700">{line}</p>
      {pl && <p className="text-sm text-slate-700">{pl}</p>}
      {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {canRenew && st.enabled && (
          <button type="button" disabled={busy} onClick={() => call('/api/seo/subscription/start')}
            className="rounded-lg bg-[#2E63F6] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {sub.status === 'past_due' ? 'עדכון כרטיס וחידוש' : 'חידוש המנוי'}
          </button>
        )}
        {sub.status === 'active' && sub.renews === false && (
          <Link to="/seo-plan" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">חידוש או שינוי תוכנית</Link>
        )}
        {canCancel && !confirming && (
          <button type="button" onClick={() => setConfirming(true)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            ביטול המנוי
          </button>
        )}
        {canCancel && confirming && (
          <>
            <span className="text-sm text-slate-700">
              {annualPlan
                ? 'לבטל? הביטול מבטל חידוש בלבד, בלי החזר על חודשים שנותרו. הגישה תימשך עד סוף התקופה ששולמה.'
                : 'לבטל? לא יהיו חיובים נוספים והגישה תימשך עד סוף התקופה ששולמה.'}
            </span>
            <button type="button" disabled={busy} onClick={() => call('/api/seo/subscription/cancel')}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">כן, לבטל</button>
            <button type="button" onClick={() => setConfirming(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700">לא, להשאיר</button>
          </>
        )}
      </div>
    </div>
  );
}
