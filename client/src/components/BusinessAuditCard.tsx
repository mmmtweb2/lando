import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Star, CheckCircle2, AlertCircle } from 'lucide-react';
import { authFetch } from '../lib/api';
import { RoleTag } from './RoleTag';
import NoProfileGuide from './NoProfileGuide';
import BusinessSearch from './BusinessSearch';
import AuditLeadForm from './AuditLeadForm';
import ConciergeButton from './ConciergeButton';
import { SnapshotButton, regionFacts } from './AuditSnapshot';
import {
  LEVEL_STYLE, scoreStyle, isNumericValue, scoreExplainer, sparseExplainer, benchmarkNote,
  type Audit, type AiReadiness, type CategoryCheck,
} from '../lib/auditShared';
import AiReadinessBlock from './AiReadinessBlock';
import { trackEvent } from '../lib/track';
import RecommendationsList from './RecommendationsList';
import { rememberPlace, trackPublic } from '../lib/journeyClient';
import { buildRecommendations } from '../lib/recommendations';

// Stage 5.5.2 — find the customer's business on Google Maps and show a live Audit.
// All Google calls go through our server (/api/seo/places/*); the API key never
// reaches the browser. The search itself is BusinessSearch (shared with the onboarding step).
// Account mode asks "זה העסק שלי?" before anything runs (QA 24.11); the free /audit page checks
// any listing on pick, since it is a public check of public data.

interface SavedBusiness { id: string; name: string; google_place_id: string | null }

// The last audit of each place in this page load, so the dashboard's profile screen opens with the score at once
// when the customer comes back to it (README part 149). "בדיקה מחדש" always asks the server again.
const lastAudit = new Map<string, { at: number; body: Record<string, unknown> }>();
const LAST_AUDIT_MS = 10 * 60_000;

/**
 * `connectedView` (the dashboard's profile screen): when a business is already connected, the card opens on THAT
 * business with its score, and searching another business is one button away (README part 149). The connected
 * business was confirmed when it was connected, so it runs without the "זה העסק שלי?" step (README part 152).
 */
export default function BusinessAuditCard({ mode = 'account', onSelect, onPending, hideNoProfile = false, connectedView = false }: { mode?: 'account' | 'public'; onSelect?: (placeId: string) => void; onPending?: (name: string) => Promise<void> | void; hideNoProfile?: boolean; connectedView?: boolean }) {
  // 'public' = the signed-out /audit page: no login, no saved businesses, a lead form instead of
  // "connect this business to my account". Same card, same score (the server wraps the same code).
  const isPublic = mode === 'public';
  const api = isPublic ? fetch : authFetch;
  const auditUrl = (id: string) => isPublic ? `/api/public/audit/${encodeURIComponent(id)}` : `/api/seo/places/${encodeURIComponent(id)}/audit`;
  const [auditing, setAuditing] = useState(false);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [aiReadiness, setAiReadiness] = useState<AiReadiness | null>(null);
  const [categoryCheck, setCategoryCheck] = useState<CategoryCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noProfile, setNoProfile] = useState(false);
  const [saved, setSaved] = useState<SavedBusiness[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const auditSeq = useRef(0);
  const [searchOther, setSearchOther] = useState(false);
  const autoRan = useRef(false);

  useEffect(() => {
    if (isPublic) return;   // a signed-out visitor has no saved businesses
    (async () => {
      try {
        const r = await authFetch('/api/seo/businesses');
        if (!r.ok) return;
        const body = await r.json().catch(() => ({}));
        setSaved(body.businesses ?? []);
      } catch { /* the saved list is a convenience; the search still works without it */ }
    })();
  }, []);

  function clearAudit() {
    auditSeq.current++; // an audit still in flight must not land after the visitor moved on
    setAudit(null); setAiReadiness(null); setCategoryCheck(null); setError(null); setSaveMsg(null); setAuditing(false);
  }

  // Account mode: called only after the customer confirmed "זה העסק שלי" (BusinessSearch), or for a
  // business already saved to the account. Public mode (/audit, a free check of any listing): on pick.
  async function runAudit(placeId: string, quiet = false) {
    if (!quiet) onSelect?.(placeId);
    clearAudit();
    const mine = auditSeq.current;
    setNoProfile(false);
    setAuditing(true);
    try {
      trackEvent('Audit_Started', { mode });
      if (isPublic) trackPublic('audit_started', { place_id: placeId });
      const kept = quiet ? lastAudit.get(placeId) : undefined;
      const fresh = kept && Date.now() - kept.at < LAST_AUDIT_MS ? kept.body : null;
      const r = fresh ? null : await api(auditUrl(placeId));
      const body = fresh ?? await r!.json().catch(() => ({}));
      if (mine !== auditSeq.current) return;
      if (r && !r.ok) { setError(body.error ?? 'הבדיקה נכשלה. נסו שוב.'); return; }
      if (!isPublic) lastAudit.set(placeId, { at: Date.now(), body });
      setAudit(body.audit as Audit);
      if (isPublic) trackPublic('audit_completed', { place_id: placeId, score: (body.audit as Audit).score });
      setAiReadiness((body.aiReadiness ?? null) as AiReadiness | null);
      if (body.aiReadiness?.status === 'ok') trackEvent('AI_Readiness_Viewed', { mode, passed: (body.aiReadiness.checks as Array<{ state: string }>).filter(c => c.state === 'pass').length });
      setCategoryCheck((body.categoryCheck ?? null) as CategoryCheck | null);
    } catch {
      if (mine === auditSeq.current) setError('הבדיקה נכשלה. בדקו את החיבור ונסו שוב.');
    } finally {
      if (mine === auditSeq.current) setAuditing(false);
    }
  }

  // The connected business opens with its score: no need to press "בדיקה מחדש" first.
  useEffect(() => {
    if (!connectedView || isPublic || autoRan.current || audit || auditing) return;
    const first = saved.find((b) => b.google_place_id);
    if (!first) return;
    autoRan.current = true;
    void runAudit(first.google_place_id!, true);
  }, [connectedView, saved]); // eslint-disable-line react-hooks/exhaustive-deps

  // The recommendations list is on screen as soon as the audit is (public funnel step).
  useEffect(() => {
    if (isPublic && audit) trackPublic('recs_viewed', { place_id: audit.placeId, top: buildRecommendations(audit)[0]?.key });
  }, [isPublic, audit?.placeId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveCurrent() {
    if (!audit) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await authFetch('/api/seo/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId: audit.placeId }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setSaveMsg(body.error ?? 'השמירה נכשלה. נסו שוב.'); return; }
      setSaved(prev => prev.some(x => x.id === body.business.id) ? prev : [...prev, body.business]);
      window.dispatchEvent(new Event('seo-businesses-changed'));
    } catch {
      setSaveMsg('השמירה נכשלה. בדקו את החיבור ונסו שוב.');
    } finally {
      setSaving(false);
    }
  }

  async function removeSaved(id: string) {
    try {
      const r = await authFetch(`/api/seo/businesses/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (r.ok) {
        setSaved(prev => prev.filter(x => x.id !== id));
        window.dispatchEvent(new Event('seo-businesses-changed'));
      }
    } catch { /* leave the list as it was */ }
  }

  const isSaved = !!audit && saved.some(x => x.google_place_id === audit.placeId);
  const hasGaps = !!audit && audit.items.some(i => i.tip);
  const sc = audit ? scoreStyle(audit.score, hasGaps) : null;
  const sparse = audit ? sparseExplainer(audit) : null;
  const connected = connectedView && !isPublic ? saved.find((b) => b.google_place_id) ?? null : null;
  // With a connected business, the search box is for checking ANOTHER business, behind its own button.
  const showSearch = !connected || searchOther;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 flex flex-col gap-5">
      <div>
        <h3 className="text-base font-semibold text-slate-900">בדיקת מצב העסק בגוגל מפות</h3>
        {connected ? (
          <p className="mt-1 text-sm text-slate-500">
            העסק שמחובר לחשבון: <strong className="font-semibold text-slate-900">{connected.name}</strong>. כאן רואים איך הכרטיס שלו בגוגל נראה היום ביחס לעסקים דומים באזור, ומה כדאי לחזק.
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">
            {isPublic
              ? 'הקלידו את שם העסק והעיר, ונראה איך כרטיס העסק בגוגל נראה היום ביחס לעסקים דומים באזור, ומה כדאי לחזק.'
              : 'חפשו את העסק שלכם, אשרו שזה הוא, ונראה איך הכרטיס שלכם בגוגל נראה היום ביחס לעסקים דומים באזור.'}
          </p>
        )}
      </div>

      {!isPublic && saved.length > 0 && !noProfile && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-slate-900">העסקים שלי</p>
          <ul className="flex flex-col gap-2">
            {saved.map(b => (
              <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm text-slate-900">
                  <CheckCircle2 size={14} className="flex-shrink-0 text-emerald-600" />
                  <span className="truncate">{b.name}</span>
                </span>
                <span className="flex flex-shrink-0 items-center gap-3 text-xs">
                  {b.google_place_id && (
                    <button type="button" onClick={() => runAudit(b.google_place_id!)} className="font-medium text-[#2E63F6] hover:underline">
                      בדיקה מחדש
                    </button>
                  )}
                  <button type="button" onClick={() => removeSaved(b.id)} className="text-slate-600 hover:text-rose-600">
                    הסרה
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {connected && !searchOther && !noProfile && (
        <button type="button" onClick={() => { setSearchOther(true); clearAudit(); }} className="self-start text-sm font-medium text-[#2E63F6] hover:underline">
          בדיקה של עסק אחר
        </button>
      )}

      {!showSearch ? null : noProfile ? (
        <NoProfileGuide onBack={() => setNoProfile(false)} onPending={isPublic ? undefined : onPending} />
      ) : (
        <BusinessSearch
          mode={mode}
          confirm={!isPublic}
          withButton={isPublic}
          onConfirm={(s) => void runAudit(s.placeId)}
          onQueryChange={clearAudit}
          onNoProfile={hideNoProfile ? undefined : () => { clearAudit(); setNoProfile(true); }}
        />
      )}

      {auditing && !noProfile && (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={16} className="animate-spin" aria-hidden /> {connected && !searchOther ? `בודקים את ${connected.name}…` : 'בודקים את העסק…'}</p>
      )}

      {error && !noProfile && (
        <p className="flex items-center gap-2 text-sm text-rose-700" role="alert">
          <AlertCircle size={15} className="flex-shrink-0" /> {error}
        </p>
      )}

      {audit && sc && !noProfile && (
        <div className="flex flex-col gap-5 border-t border-slate-100 pt-5" data-testid="audit-result">
          <div className="flex items-center gap-4">
            <div className={`flex h-20 w-20 flex-shrink-0 flex-col items-center justify-center rounded-full border-4 ${sc.ring}`}>
              <span className="text-2xl font-semibold leading-none">{audit.score}</span>
              <span className="text-[10px] text-slate-600">מתוך 100</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{audit.name}</p>
              {audit.address && <p className="text-xs text-slate-500 truncate">{audit.address}</p>}
              <p className={`mt-1 text-sm font-medium ${sc.ring.split(' ')[1]}`}>{sc.label}</p>
              {audit.rating !== null && (
                <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                  <Star size={12} className="text-amber-500" /> {audit.rating.toFixed(1)} · {audit.reviewCount} ביקורות
                </p>
              )}
            </div>
          </div>

          {sparse && (
            <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-slate-800">
              <p className="mb-0.5 text-sm font-semibold text-slate-900">{sparse.title}</p>
              <p>{sparse.text}</p>
              {sparse.gains.length > 0 && (
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {sparse.gains.map(g => (
                    <li key={g.key} className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900">{g.label} <span dir="ltr">+{g.points}</span></li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
            <p>
              {audit.benchmark
                ? `הציון נמדד מול ${audit.benchmark.count} עסקים דומים באזור (יעד דירוג: ${audit.benchmark.ratingTarget.toFixed(1)}).${regionFacts(audit.benchmark)}${audit.benchmark.reviewsTargetKind ? ` יעד הביקורות שלכם: ${audit.benchmark.reviewsTarget}${audit.benchmark.reviewsTargetKind === 'max' ? ' (הגבוה ביותר באזור)' : ' (החציון באזור)'}.` : ''}`
                : benchmarkNote(audit)}
            </p>
            {audit.benchmark?.leaders && audit.benchmark.leaders.length > 0 && (
              <div className="mt-2" data-testid="leaders">
                <p className="font-semibold text-slate-800">העסקים המובילים באזור (לפי מספר הביקורות):</p>
                <ol className="mt-1 flex flex-col gap-1">
                  {audit.benchmark.leaders.map((l, i) => (
                    <li key={`${l.name}-${i}`} className="flex items-center justify-between gap-3 rounded-md bg-white px-2 py-1">
                      <span className="min-w-0 truncate text-slate-800">{i + 1}. {l.name}</span>
                      <span className="flex flex-shrink-0 items-center gap-1 text-slate-600">
                        <Star size={11} className="text-amber-500" aria-hidden /> <span dir="ltr">{l.rating.toFixed(1)}</span> · {l.reviews.toLocaleString('he-IL')} ביקורות
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          {(() => {
            const ex = scoreExplainer(audit);
            return ex && (
              <div role="note" className={`rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${ex.vsHighest ? 'border-blue-200 bg-blue-50 text-slate-800' : 'border-slate-100 bg-slate-50 text-slate-600'}`}>
                <p className="mb-0.5 text-sm font-semibold text-slate-900">{ex.title}</p>
                <p>{ex.text}</p>
              </div>
            );
          })()}

          {categoryCheck && (
            <p className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${categoryCheck.status === 'same' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
              {categoryCheck.line}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-slate-900">מה בדקנו, מי עושה מה</p>
            <ul className="flex flex-col gap-2">
              {audit.items.map(i => (
                <li key={i.key} className="rounded-lg border border-slate-100 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      <span className={`h-2 w-2 rounded-full ${LEVEL_STYLE[i.level].dot}`} /> {i.label}
                    </span>
                    <span
                      className={`text-sm font-semibold ${LEVEL_STYLE[i.level].text}`}
                      // Numeric values like "10+" must keep their order inside the RTL page ("+10" otherwise).
                      dir={isNumericValue(i.value) ? 'ltr' : undefined}
                    >
                      {i.value}
                    </span>
                  </div>
                  {i.tip && <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{i.tip}</p>}
                  <div className="mt-2 flex flex-col gap-1.5">
                    {i.youDo && (
                      <p className="flex items-start gap-2 text-xs text-slate-700">
                        <RoleTag who="you" /> <span>{i.youDo}</span>
                      </p>
                    )}
                    {/* Only what the product does today (QA 24.11: no "בקרוב" placeholders). */}
                    {i.weDoAvailability === 'now' && (
                      <p className="flex items-start gap-2 text-xs text-slate-700">
                        <RoleTag who="we" /> <span>{i.weDo}</span>
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {isPublic && (
            <>
              <RecommendationsList audit={audit} />
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 flex flex-col gap-2">
                <p className="text-sm font-semibold text-slate-900">זה העסק שלכם? רוצים שנטפל בזה בשבילכם?</p>
                <p className="text-xs leading-relaxed text-slate-600">פותחים חשבון, מחברים את העסק הזה ומקבלים שלבי הקמה קצרים. ההרשמה לוקחת כמה שניות. ניהול הכרטיס עצמו נעשה אחר כך, עם חשבון הגוגל שמנהל אותו.</p>
                <Link
                  to="/login?mode=signup&next=/start"
                  onClick={() => rememberPlace(audit.placeId)}
                  className="self-start rounded-lg bg-[#2E63F6] px-4 py-2 text-sm font-medium text-white hover:bg-[#2552d0]"
                >
                  זה העסק שלי: פתחו חשבון וחברו אותו
                </Link>
              </div>
            </>
          )}

          {aiReadiness && <AiReadinessBlock data={aiReadiness} />}

          <p className="text-[11px] text-slate-600">
            מקור הנתונים: Google Maps.{' '}
            {audit.mapsUrl && (
              <a href={audit.mapsUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600">
                צפייה בכרטיס העסק במפות
              </a>
            )}
          </p>

          {isPublic ? (
            <AuditLeadForm placeId={audit.placeId} businessName={audit.name} score={audit.score} />
          ) : (
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 flex flex-col gap-2">
              {isSaved ? (
                <p className="flex items-center gap-2 text-sm text-emerald-700">
                  <CheckCircle2 size={15} /> העסק מחובר לחשבון שלכם.
                </p>
              ) : (
                <>
                  <p className="flex items-start gap-2 text-sm text-slate-700">
                    <RoleTag who="you" />
                    <span>חברו את העסק לחשבון, כדי להמשיך להקמה. כדי לנהל את הכרטיס עצמו תתבקשו בהמשך להתחבר עם חשבון הגוגל שמנהל אותו.</span>
                  </p>
                  <button
                    type="button"
                    onClick={saveCurrent}
                    disabled={saving}
                    className="self-start rounded-lg bg-[#2E63F6] px-4 py-2 text-sm font-medium text-white hover:bg-[#2552d0] disabled:opacity-60"
                  >
                    {saving ? 'מחברים…' : 'חיבור העסק לחשבון'}
                  </button>
                </>
              )}
              {saveMsg && <p className="text-sm text-rose-700" role="alert">{saveMsg}</p>}
            </div>
          )}

          <div className="flex flex-wrap items-start gap-3">
            <SnapshotButton audit={audit} />
            <ConciergeButton location="audit" businessName={audit.name} score={audit.score} />
          </div>

          {audit.items.every(i => !i.tip) && (
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 size={15} /> כרטיס העסק במצב טוב. כדאי להמשיך לעדכן אותו מדי פעם.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
