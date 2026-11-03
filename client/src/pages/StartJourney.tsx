import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { authFetch } from '../lib/api';
import BusinessAuditCard from '../components/BusinessAuditCard';
import RecommendationsList from '../components/RecommendationsList';
import { takePlace, trackAccount } from '../lib/journeyClient';
import type { Audit } from '../lib/auditShared';
import { buildRecommendations } from '../lib/recommendations';

// /start — the journey after the public Audit: sign up -> pick the business -> go through the
// recommendations -> activate. The server owns the state (registered / setup / ready_to_activate /
// active); this page only shows the step that state calls for. Whether activation is free (beta)
// or paid is decided by the server flag PAYMENT_GATE_ENABLED, never here.

interface View {
  state: 'registered' | 'setup' | 'ready_to_activate' | 'active_beta' | 'active';
  placeId: string | null; requested: boolean; started: boolean;
  gates: { paymentGate: boolean; betaSelfActivation: boolean };
}

const STEPS = ['העסק', 'המלצות', 'הפעלה'];
const stepOf = (s: View['state']) => (s === 'registered' ? 0 : s === 'setup' ? 1 : s === 'ready_to_activate' ? 2 : 3);

async function call(path: string, method = 'POST', body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const r = await authFetch(`/api/seo/journey${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

function Progress({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="התקדמות">
      {STEPS.map((t, i) => (
        <li key={t} className="flex flex-1 flex-col gap-1">
          <span className={`h-1.5 rounded-full ${i < step ? 'bg-emerald-500' : i === step ? 'bg-[#2E63F6]' : 'bg-slate-200'}`} />
          <span className={i === step ? 'font-semibold text-slate-900' : 'text-slate-500'}>{i + 1}. {t}</span>
        </li>
      ))}
    </ol>
  );
}

function Recommendations({ placeId, onDone, busy }: { placeId: string; onDone: () => void; busy: boolean }) {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    // Rerun the audit from the place id: nothing about the business was stored except that id.
    authFetch(`/api/seo/places/${encodeURIComponent(placeId)}/audit`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('audit'))))
      .then(b => { if (alive) { setAudit(b.audit as Audit); trackAccount('recs_viewed', { place_id: placeId, top: buildRecommendations(b.audit as Audit)[0]?.key }); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [placeId]);

  if (failed) return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">לא הצלחנו לטעון את הבדיקה כרגע. נסו לרענן את הדף.</p>;
  if (!audit) return <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> בודקים את הפרופיל שלכם…</p>;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-semibold text-slate-900">{audit.name}</p>
        <p className="text-xs text-slate-500">ציון נוכחי: {audit.score} מתוך 100</p>
      </div>
      <RecommendationsList audit={audit} />
      <button type="button" onClick={onDone} disabled={busy} className="self-start rounded-lg bg-[#2E63F6] px-4 py-2 text-sm font-medium text-white hover:bg-[#2552d0] disabled:opacity-60">
        {busy ? 'רגע…' : 'עברתי על ההמלצות, ממשיכים'}
      </button>
    </div>
  );
}

export default function StartJourney() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => { document.title = 'ההקמה שלכם | Pagey'; }, []);

  // Start the journey once, then carry over the business picked on /audit (if any).
  useEffect(() => {
    if (!user || started.current) return;
    started.current = true;
    (async () => {
      try {
        const s = await call('/start', 'POST', {});
        if (!s.ok) { setError(String(s.data.error ?? 'לא הצלחנו להתחיל. נסו שוב.')); return; }
        let v = s.data as unknown as View;
        const place = takePlace();
        if (place && v.state === 'registered') {
          const p = await call('/business', 'PUT', { placeId: place });
          if (p.ok) v = p.data as unknown as View;
        }
        setView(v);
      } catch { setError('לא הצלחנו להתחיל. בדקו את החיבור ונסו שוב.'); }
    })();
  }, [user]);

  const step = view?.state;
  useEffect(() => { if (step === 'ready_to_activate') trackAccount('activation_viewed'); }, [step]);

  const choose = useCallback(async (placeId: string) => {
    setBusy(true); setError(null);
    const r = await call('/business', 'PUT', { placeId });
    setBusy(false);
    if (r.ok) setView(r.data as unknown as View); else setError(String(r.data.error ?? 'לא הצלחנו לשמור את העסק.'));
  }, []);

  const finishRecs = useCallback(async () => {
    setBusy(true); setError(null);
    const r = await call('/setup-complete');
    setBusy(false);
    if (r.ok) setView(r.data as unknown as View); else setError(String(r.data.error ?? 'משהו השתבש. נסו שוב.'));
  }, []);

  const activate = useCallback(async () => {
    setBusy(true); setError(null); setMsg(null);
    const r = await call('/activate');
    setBusy(false);
    if (r.status === 402) { navigate(String(r.data.next ?? '/seo-plan')); return; }
    if (!r.ok) { setError(String(r.data.error ?? 'משהו השתבש. נסו שוב.')); return; }
    setView(r.data as unknown as View);
    if (r.data.requested) setMsg('קיבלנו את הבקשה שלכם. אנחנו מפעילים חשבונות בטא ידנית, ונעדכן אתכם במייל.');
  }, [navigate]);

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 size={28} className="animate-spin text-indigo-500" /></div>;
  if (!user) return <Navigate to="/login?mode=signup&next=/start" replace />;

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-extrabold text-[#2E63F6]">Pagey</Link>
          <Link to="/dashboard" className="text-xs text-slate-500 hover:underline">לדשבורד</Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8">
        {!view && !error && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> טוענים…</p>}
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}

        {view && (
          <>
            {stepOf(view.state) < 3 && <Progress step={stepOf(view.state)} />}

            {view.state === 'registered' && (
              <section className="flex flex-col gap-3">
                <h1 className="text-xl font-extrabold text-slate-900">איזה עסק נחזק?</h1>
                <p className="text-sm text-slate-600">חפשו את העסק שלכם ובחרו אותו מהרשימה.</p>
                <BusinessAuditCard mode="account" onSelect={choose} />
                {busy && <p className="text-xs text-slate-500">שומרים…</p>}
              </section>
            )}

            {view.state === 'setup' && view.placeId && (
              <section className="flex flex-col gap-3">
                <h1 className="text-xl font-extrabold text-slate-900">ההמלצות לעסק שלכם</h1>
                <Recommendations placeId={view.placeId} onDone={finishRecs} busy={busy} />
              </section>
            )}

            {view.state === 'ready_to_activate' && (
              <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5">
                <h1 className="text-xl font-extrabold text-slate-900">מוכנים להפעלה</h1>
                {view.requested ? (
                  <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">{msg ?? 'הבקשה שלכם התקבלה. נפעיל את החשבון ונעדכן אתכם במייל.'}</p>
                ) : (
                  <>
                    <p className="text-sm text-slate-600">
                      {view.gates.paymentGate
                        ? 'ההפעלה כוללת מנוי. בלחיצה נעבור לדף התשלום.'
                        : 'אתם בין הראשונים לנסות. ההפעלה בטא וללא תשלום.'}
                    </p>
                    <button type="button" onClick={activate} disabled={busy} className="self-start rounded-lg bg-[#2E63F6] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#2552d0] disabled:opacity-60">
                      {busy ? 'רגע…' : view.gates.paymentGate ? 'המשך לתשלום' : 'הפעל (בטא, ללא תשלום)'}
                    </button>
                  </>
                )}
              </section>
            )}

            {(view.state === 'active_beta' || view.state === 'active') && (
              <section className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                <h1 className="flex items-center gap-2 text-xl font-extrabold text-emerald-900"><CheckCircle2 size={22} /> החשבון פעיל</h1>
                <p className="text-sm text-emerald-900">{view.state === 'active_beta' ? 'הופעלתם בגרסת הבטא. אפשר להתחיל.' : 'הכול מוכן. אפשר להתחיל.'}</p>
                <Link to="/dashboard" className="self-start rounded-lg bg-[#2E63F6] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#2552d0]">לדשבורד</Link>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
