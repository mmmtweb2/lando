import { useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ExternalLink, Loader2, MapPin, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { authFetch } from '../lib/api';
import {
  MAX_QUERY_LEN, MIN_QUERY_LEN, NO_RESULT_TIPS, RELEVANCE_LABEL, mapsLink, queryError, rankSuggestions, searchView,
  type RankedSuggestion, type Suggestion,
} from '../lib/businessSearch';

// The business search used by the onboarding step "חיבור כרטיס" (GuidedSetup), the /start journey and
// the dashboard check (BusinessAuditCard, account mode) and the free /audit page (public mode).
// QA 24.11:
//   • picking a result connected it at once → now an explicit confirmation card comes first
//     ("זה העסק שלי" / "זה לא העסק שלי, חזרה לחיפוש"), saying that managing the listing needs the
//     Google account that manages it;
//   • no results showed "מחפשים…" and then nothing, and old results stayed during a new search →
//     results are cleared on every keystroke, and empty / error states say what happened (with retry);
//   • unrelated results looked like matches, and the dropdown covered "אין לי כרטיס עסק" → each result
//     says how well its name matches, the list sits in the page flow (nothing is covered), and its
//     last option is "העסק שלי לא ברשימה".
// Everything shown here is public Google Maps data (name and address line from autocomplete).

const C = {
  ink: 'text-[var(--ink,#0f172a)]',
  muted: 'text-[var(--muted,#475569)]',
  line: 'border-[var(--line,#e2e8f0)]',
  accent: 'text-[var(--accent-strong,#2E63F6)]',
};

const BADGE: Record<RankedSuggestion['relevance'], string> = {
  strong: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  partial: 'bg-amber-50 text-amber-800 border-amber-200',
  none: 'bg-slate-100 text-slate-700 border-slate-200',
};

function newSessionToken(): string {
  try { return crypto.randomUUID(); } catch { return `s${Date.now()}${Math.random().toString(36).slice(2, 10)}`; }
}

export interface BusinessSearchProps {
  mode?: 'account' | 'public';
  /** true → a confirmation card ("זה העסק שלי?") comes between the pick and onConfirm. */
  confirm?: boolean;
  onConfirm: (s: Suggestion) => void;
  /** Shows the "אין לי כרטיס עסק בגוגל" path (always visible, never covered). */
  onNoProfile?: () => void;
  /** The visitor typed again after a pick: the parent clears what it showed for the old one. */
  onQueryChange?: () => void;
  /** A visible search button next to the field (the free check page). */
  withButton?: boolean;
  /** Disables the confirmation buttons while the parent saves. */
  busy?: boolean;
  label?: string;
  placeholder?: string;
}

export default function BusinessSearch({
  mode = 'account', confirm = true, onConfirm, onNoProfile, onQueryChange, withButton = false, busy = false,
  label = 'שם העסק והעיר', placeholder = 'למשל: קייטרינג דוד, חיפה',
}: BusinessSearchProps) {
  const isPublic = mode === 'public';
  const searchUrl = isPublic ? '/api/public/audit/search' : '/api/seo/places/autocomplete';
  const api = isPublic ? fetch : authFetch;
  const inputId = useId();
  const listId = useId();
  const msgId = useId();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<RankedSuggestion[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldMsg, setFieldMsg] = useState<string | null>(null);
  const [picked, setPicked] = useState<RankedSuggestion | null>(null);
  const [notListed, setNotListed] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [run, setRun] = useState(0);           // bump = search now (Enter, button, retry)
  const [chosen, setChosen] = useState(false); // a pick was confirmed: the field shows its name, no search
  const seq = useRef(0);
  const session = useRef(newSessionToken());
  const immediate = useRef(false);
  const lastRun = useRef(0);
  const confirmRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (chosen) return;
    const text = q.trim();
    if (text.length < MIN_QUERY_LEN) { seq.current++; setSearching(false); return; }
    const mine = ++seq.current;
    const delay = immediate.current ? 0 : 350;
    immediate.current = false;
    const t = setTimeout(async () => {
      setSearching(true); setError(null);
      try {
        const r = await api(searchUrl, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: text, sessionToken: session.current }),
        });
        const body = await r.json().catch(() => ({})) as { suggestions?: Suggestion[]; error?: string; code?: string };
        if (mine !== seq.current) return;
        if (!r.ok) {
          setResults(null);
          setError(body.code === 'places_not_configured' || body.code === 'public_audit_disabled'
            ? 'חיפוש העסקים יופעל בקרוב.'
            : (body.error ?? 'החיפוש נכשל.'));
          return;
        }
        setResults(rankSuggestions(text, body.suggestions ?? []));
        setActiveIdx(-1);
      } catch {
        if (mine === seq.current) { setResults(null); setError('החיפוש נכשל. בדקו את החיבור לאינטרנט.'); }
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, delay);
    return () => clearTimeout(t);
  }, [q, run]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (picked) confirmRef.current?.focus({ preventScroll: false }); }, [picked]);

  function onType(v: string) {
    let next = v;
    if (v.length > MAX_QUERY_LEN) { next = v.slice(0, MAX_QUERY_LEN); setFieldMsg(queryError(v, false)); }
    else setFieldMsg(null);
    setQ(next);
    // A new query never shows the previous one's results.
    setResults(null); setError(null); setPicked(null); setNotListed(false); setActiveIdx(-1);
    if (chosen) { setChosen(false); }
    onQueryChange?.();
  }

  function searchNow() {
    const msg = queryError(q, true);
    setFieldMsg(msg);
    if (msg) { inputRef.current?.focus(); return; }
    if (chosen) setChosen(false);
    // Debounce skipped; also re-runs the same text (retry after an error).
    if (Date.now() - lastRun.current < 300) return;
    lastRun.current = Date.now();
    immediate.current = true;
    setResults(null); setError(null); setPicked(null); setNotListed(false);
    setRun((n) => n + 1);
  }

  function pick(s: RankedSuggestion) {
    if (!confirm) { finish(s); return; }
    setPicked(s);
  }
  function finish(s: Suggestion) {
    seq.current++;
    setChosen(true);
    setQ(s.name);
    setResults(null); setPicked(null); setNotListed(false); setError(null);
    session.current = newSessionToken(); // a new billing session starts after a selection
    onConfirm(s);
  }
  function backToResults() {
    setPicked(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const view = searchView({ query: q, searching, error, results: chosen ? null : results });
  const listShown = view.status === 'results' && !picked && !notListed;
  const optionCount = listShown ? (results?.length ?? 0) + 1 : 0; // + "העסק שלי לא ברשימה"
  const optionId = (i: number) => `${listId}-o${i}`;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (listShown && activeIdx >= 0) {
        if (activeIdx < (results?.length ?? 0)) pick(results![activeIdx]); else setNotListed(true);
        return;
      }
      searchNow();
      return;
    }
    if (!listShown) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => (i + 1) % optionCount); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => (i <= 0 ? optionCount - 1 : i - 1)); }
    else if (e.key === 'Escape') { e.preventDefault(); setActiveIdx(-1); }
  }

  const live = picked ? `נבחר ${picked.name}. זה העסק שלכם?`
    : view.status === 'results' ? view.title
    : view.status === 'empty' ? view.title
    : view.status === 'searching' ? 'מחפשים…' : '';

  const noProfileBtn = onNoProfile && (
    <button
      type="button" onClick={onNoProfile}
      className={`min-h-[44px] self-start px-1 text-sm font-semibold underline underline-offset-4 ${C.accent}`}
    >
      אין לי כרטיס עסק בגוגל מפות
    </button>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="business-search">
      <label htmlFor={inputId} className={`text-sm font-semibold ${C.ink}`}>{label}</label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={18} aria-hidden className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 ${C.muted}`} />
          <input
            ref={inputRef} id={inputId} value={q} onChange={(e) => onType(e.target.value)} onKeyDown={onKeyDown}
            autoComplete="off" placeholder={placeholder} enterKeyHint="search"
            role="combobox" aria-autocomplete="list" aria-expanded={listShown} aria-controls={listId}
            aria-activedescendant={listShown && activeIdx >= 0 ? optionId(activeIdx) : undefined}
            aria-invalid={!!fieldMsg} aria-describedby={fieldMsg ? msgId : undefined}
            className={`min-h-[48px] w-full rounded-[10px] border ${fieldMsg ? 'border-rose-400' : C.line} bg-white pr-10 pl-10 text-[16px] ${C.ink} placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2E63F6]/30 focus:border-[#2E63F6]`}
          />
          {searching && <Loader2 size={18} aria-hidden className={`absolute left-3 top-1/2 -translate-y-1/2 animate-spin ${C.muted}`} />}
        </div>
        {withButton && (
          <button type="button" onClick={searchNow} className="min-h-[48px] rounded-[10px] bg-[#2E63F6] px-4 text-sm font-semibold text-white hover:bg-[#2552d0]">
            חיפוש
          </button>
        )}
      </div>
      {fieldMsg && <p id={msgId} role="alert" className="-mt-1 text-sm text-rose-700">{fieldMsg}</p>}
      <p className="sr-only" role="status" aria-live="polite">{live}</p>

      {view.status === 'searching' && (
        <p className={`flex items-center gap-2 text-sm ${C.muted}`}><Loader2 size={16} className="animate-spin" aria-hidden /> מחפשים…</p>
      )}

      {view.status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2.5">
          <p className="flex items-center gap-2 text-sm text-rose-800"><AlertCircle size={16} aria-hidden /> {view.title}</p>
          <button type="button" onClick={searchNow} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-3 text-sm font-semibold text-rose-800 hover:bg-rose-100">
            <RotateCcw size={14} aria-hidden /> נסו שוב
          </button>
        </div>
      )}

      {listShown && (
        <div className="flex flex-col gap-2">
          <p className={`text-sm font-semibold ${view.noneMatch ? 'text-amber-800' : C.ink}`}>{view.title}</p>
          <ul id={listId} role="listbox" aria-label="עסקים שנמצאו" className="flex flex-col gap-2">
            {results!.map((s, i) => (
              <li
                key={s.placeId} id={optionId(i)} role="option" aria-selected={i === activeIdx}
                onClick={() => pick(s)} onMouseEnter={() => setActiveIdx(i)}
                className={`flex min-h-[56px] cursor-pointer items-start gap-2 rounded-[10px] border ${C.line} px-3 py-2.5 ${i === activeIdx ? 'bg-slate-100' : 'bg-white hover:bg-slate-50'}`}
              >
                <MapPin size={16} className={`mt-0.5 flex-shrink-0 ${C.muted}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={`block text-[15px] font-bold ${C.ink}`}>{s.name}</span>
                  {s.details && <span className={`block text-sm ${C.muted}`}>{s.details}</span>}
                </span>
                <span className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${BADGE[s.relevance]}`}>{RELEVANCE_LABEL[s.relevance]}</span>
              </li>
            ))}
            <li
              id={optionId(results!.length)} role="option" aria-selected={activeIdx === results!.length}
              onClick={() => setNotListed(true)} onMouseEnter={() => setActiveIdx(results!.length)}
              className={`flex min-h-[48px] cursor-pointer items-center gap-2 rounded-[10px] border border-dashed ${C.line} px-3 py-2 text-sm font-semibold ${C.accent} ${activeIdx === results!.length ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
            >
              העסק שלי לא ברשימה
            </li>
          </ul>
        </div>
      )}

      {(view.status === 'empty' || notListed) && !picked && (
        <div role="status" className={`flex flex-col gap-2 rounded-[10px] border ${C.line} bg-slate-50 p-4`}>
          <p className={`text-[15px] font-bold ${C.ink}`}>{notListed ? 'העסק שלכם לא ברשימה?' : view.title}</p>
          <ul className={`list-disc pr-5 text-sm leading-relaxed ${C.muted}`}>
            {NO_RESULT_TIPS.map((t) => <li key={t}>{t}</li>)}
          </ul>
          {onNoProfile && <p className={`text-sm ${C.muted}`}>עדיין אין לעסק כרטיס בגוגל, או שהוא ממתין לאימות? אפשר להמשיך גם כך:</p>}
          {notListed && (
            <button type="button" onClick={() => setNotListed(false)} className={`self-start text-sm font-semibold underline underline-offset-4 ${C.accent}`}>
              חזרה לתוצאות
            </button>
          )}
        </div>
      )}

      {picked && (
        <div
          ref={confirmRef} tabIndex={-1} role="group" aria-labelledby={`${listId}-ct`}
          className="flex flex-col gap-3 rounded-xl border-2 border-[#2E63F6]/40 bg-white p-4 outline-none" data-testid="confirm-card"
        >
          <p id={`${listId}-ct`} className={`text-base font-bold ${C.ink}`}>זה העסק שלכם?</p>
          <div className={`flex items-start gap-3 rounded-[10px] border ${C.line} bg-slate-50 p-3`}>
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#2E63F6]/10 text-[#2E63F6]"><MapPin size={20} aria-hidden /></span>
            <span className="min-w-0">
              <span className={`block text-[15px] font-bold ${C.ink}`}>{picked.name}</span>
              {picked.details && <span className={`block text-sm ${C.muted}`}>{picked.details}</span>}
              <a href={mapsLink(picked.placeId)} target="_blank" rel="noopener noreferrer" className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold underline ${C.accent}`}>
                לצפייה בכרטיס בגוגל מפות <ExternalLink size={12} aria-hidden /><span className="sr-only">(נפתח בלשונית חדשה)</span>
              </a>
            </span>
          </div>
          {picked.relevance === 'none' && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">שימו לב: השם של העסק הזה שונה ממה שחיפשתם.</p>
          )}
          <p className={`flex items-start gap-2 text-xs leading-relaxed ${C.muted}`}>
            <ShieldCheck size={16} className="mt-0.5 flex-shrink-0 text-emerald-600" aria-hidden />
            <span>
              כאן מוצג רק מידע ציבורי שמופיע לכולם בגוגל מפות. ניהול הכרטיס עצמו (עדכון פרטים, מענה לביקורות ונתוני צפיות)
              יתאפשר רק אחרי התחברות עם חשבון הגוגל שמנהל את הכרטיס, כבעלים או כמנהל.
            </span>
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button type="button" disabled={busy} onClick={() => finish(picked)} className="min-h-[44px] rounded-[10px] bg-[#2E63F6] px-5 text-sm font-semibold text-white hover:bg-[#2552d0] disabled:opacity-60">
              {busy ? 'רגע…' : 'זה העסק שלי'}
            </button>
            <button type="button" disabled={busy} onClick={backToResults} className={`min-h-[44px] rounded-[10px] border ${C.line} bg-white px-4 text-sm font-semibold ${C.ink} hover:bg-slate-50`}>
              זה לא העסק שלי, חזרה לחיפוש
            </button>
          </div>
        </div>
      )}

      {noProfileBtn}
    </div>
  );
}
