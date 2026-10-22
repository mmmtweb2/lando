import { useEffect, useRef, useState } from 'react';
import { Search, Loader2, Star, MapPin, CheckCircle2, AlertCircle } from 'lucide-react';
import { authFetch } from '../lib/api';
import { RoleTag } from './RoleTag';
import NoProfileGuide from './NoProfileGuide';

// Stage 5.5.2 — find the customer's business on Google Maps and show a live Audit.
// All Google calls go through our server (/api/seo/places/*); the API key never
// reaches the browser. Nothing is saved yet: saving the chosen business is Stage 6.1.

interface Suggestion { placeId: string; name: string; details: string }
type Level = 'good' | 'ok' | 'weak';
interface AuditItem {
  key: string; label: string; level: Level; value: string; tip: string;
  weDo: string; weDoAvailability: 'now' | 'soon'; youDo: string;
}
interface Benchmark { count: number; medianRating: number; medianReviews: number }
interface Audit {
  placeId: string; name: string; address: string | null; category: string | null;
  mapsUrl: string | null; rating: number | null; reviewCount: number;
  score: number; items: AuditItem[]; photosCapped: boolean; benchmark: Benchmark | null;
}

const LEVEL_STYLE: Record<Level, { dot: string; text: string }> = {
  good: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  ok: { dot: 'bg-amber-500', text: 'text-amber-700' },
  weak: { dot: 'bg-rose-500', text: 'text-rose-700' },
};

function scoreStyle(score: number): { ring: string; label: string } {
  if (score >= 75) return { ring: 'border-emerald-500 text-emerald-700', label: 'פרופיל חזק' };
  if (score >= 45) return { ring: 'border-amber-500 text-amber-700', label: 'יש פוטנציאל לשיפור' };
  return { ring: 'border-rose-500 text-rose-700', label: 'יש הרבה מה לחזק' };
}

function newSessionToken(): string {
  try { return crypto.randomUUID(); } catch { return `s${Date.now()}${Math.random().toString(36).slice(2, 10)}`; }
}

export default function BusinessAuditCard() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noProfile, setNoProfile] = useState(false);
  const [searched, setSearched] = useState(false);
  const sessionRef = useRef(newSessionToken());
  const seq = useRef(0);
  const pickedRef = useRef(false);

  // Debounced business search.
  useEffect(() => {
    if (pickedRef.current) { pickedRef.current = false; return; }
    const q = query.trim();
    if (q.length < 2) { setSuggestions([]); setSearched(false); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const r = await authFetch('/api/seo/places/autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: q, sessionToken: sessionRef.current }),
        });
        const body = await r.json().catch(() => ({}));
        if (mine !== seq.current) return;
        if (!r.ok) {
          setSuggestions([]);
          setError(body.code === 'places_not_configured'
            ? 'חיפוש העסקים יופעל בקרוב.'
            : (body.error ?? 'החיפוש נכשל. נסו שוב.'));
          return;
        }
        setSuggestions(body.suggestions ?? []);
        setSearched(true);
      } catch {
        if (mine === seq.current) setError('החיפוש נכשל. בדקו את החיבור ונסו שוב.');
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  async function pick(s: Suggestion) {
    pickedRef.current = true;
    seq.current++; // drop any in-flight search
    setQuery(s.name);
    setSuggestions([]);
    setAudit(null);
    setError(null);
    setAuditing(true);
    try {
      const r = await authFetch(`/api/seo/places/${encodeURIComponent(s.placeId)}/audit`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setError(body.error ?? 'הבדיקה נכשלה. נסו שוב.'); return; }
      setAudit(body.audit as Audit);
      sessionRef.current = newSessionToken(); // a new search session starts after a selection
    } catch {
      setError('הבדיקה נכשלה. בדקו את החיבור ונסו שוב.');
    } finally {
      setAuditing(false);
    }
  }

  const sc = audit ? scoreStyle(audit.score) : null;
  const noResults = searched && !searching && !auditing && !audit && suggestions.length === 0 && query.trim().length >= 2 && !error;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col gap-5">
      <div>
        <h3 className="text-base font-semibold text-slate-900">בדיקת מצב העסק בגוגל מפות</h3>
        <p className="mt-1 text-sm text-slate-500">
          הקלידו את שם העסק והעיר, ונראה איך הפרופיל שלכם נראה היום ביחס לעסקים דומים באזור, ומה כדאי לחזק.
        </p>
      </div>

      {noProfile ? (
        <NoProfileGuide onBack={() => setNoProfile(false)} />
      ) : (
        <>
          <div className="relative">
            <Search size={16} className="absolute top-1/2 -translate-y-1/2 right-3 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setAudit(null); }}
              placeholder="למשל: קייטרינג דוד, חיפה"
              aria-label="שם העסק והעיר"
              className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pr-9 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2E63F6]/30 focus:border-[#2E63F6]"
            />
            {(searching || auditing) && (
              <Loader2 size={16} className="absolute top-1/2 -translate-y-1/2 left-3 text-slate-400 animate-spin" />
            )}
            {suggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden" role="listbox">
                {suggestions.map(s => (
                  <li key={s.placeId}>
                    <button
                      type="button"
                      onClick={() => pick(s)}
                      className="w-full text-right px-3 py-2.5 hover:bg-slate-50 flex items-start gap-2"
                    >
                      <MapPin size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-900 truncate">{s.name}</span>
                        {s.details && <span className="block text-xs text-slate-500 truncate">{s.details}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {noResults && (
            <p className="text-sm text-slate-500">
              לא מצאנו עסק בשם הזה. נסו להוסיף את שם העיר או לכתוב את השם אחרת.
            </p>
          )}

          <button
            type="button"
            onClick={() => { setNoProfile(true); setSuggestions([]); setAudit(null); setError(null); }}
            className="self-start text-sm font-medium text-[#2E63F6] hover:underline"
          >
            אין לי פרופיל בגוגל מפות
          </button>
        </>
      )}

      {error && !noProfile && (
        <p className="flex items-center gap-2 text-sm text-rose-700" role="alert">
          <AlertCircle size={15} className="flex-shrink-0" /> {error}
        </p>
      )}

      {audit && sc && !noProfile && (
        <div className="flex flex-col gap-5 border-t border-slate-100 pt-5">
          <div className="flex items-center gap-4">
            <div className={`flex h-20 w-20 flex-shrink-0 flex-col items-center justify-center rounded-full border-4 ${sc.ring}`}>
              <span className="text-2xl font-semibold leading-none">{audit.score}</span>
              <span className="text-[10px] text-slate-400">מתוך 100</span>
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

          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
            {audit.benchmark
              ? `הציון נמדד ביחס ל-${audit.benchmark.count} עסקים דומים באזור (חציון: ${audit.benchmark.medianReviews} ביקורות, דירוג ${audit.benchmark.medianRating.toFixed(1)}).`
              : 'לא מצאנו מספיק עסקים דומים באזור להשוואה, ולכן הציון נמדד מול יעדים כלליים.'}
          </p>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-slate-900">מה בדקנו, מי עושה מה</p>
            <ul className="flex flex-col gap-2">
              {audit.items.map(i => (
                <li key={i.key} className="rounded-lg border border-slate-100 bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      <span className={`h-2 w-2 rounded-full ${LEVEL_STYLE[i.level].dot}`} /> {i.label}
                    </span>
                    <span className={`text-sm font-semibold ${LEVEL_STYLE[i.level].text}`}>{i.value}</span>
                  </div>
                  {i.tip && <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{i.tip}</p>}
                  <div className="mt-2 flex flex-col gap-1.5">
                    {i.youDo && (
                      <p className="flex items-start gap-2 text-xs text-slate-700">
                        <RoleTag who="you" /> <span>{i.youDo}</span>
                      </p>
                    )}
                    <p className="flex items-start gap-2 text-xs text-slate-700">
                      <RoleTag who="we" soon={i.weDoAvailability === 'soon'} /> <span>{i.weDo}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {audit.items.every(i => !i.tip) && (
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 size={15} /> הפרופיל במצב טוב. נמשיך לעקוב ולחזק אותו.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
