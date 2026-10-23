import { useCallback, useEffect, useState } from 'react';
import { Copy, Check, Loader2, Trash2, X } from 'lucide-react';
import { authFetch } from '../lib/api';
import { RoleTag } from './RoleTag';

// Stage 8 — service areas, long-tail phrases and copy-ready content for an external website.
// The generator only writes from what the customer types here ("facts"): it is told never to
// invent numbers, prices or claims, and the server removes sentences with numbers that were
// not supplied. The customer still reviews the text before publishing.

interface Saved { id: string; name: string; google_place_id: string | null }
interface Kit {
  id: string; phrase: string; created_at: string; html: string; text: string;
  kit: { title: string; metaDescription: string; dropped: number };
}
interface Settings { businessType: string; serviceAreas: string[]; phrases: string[]; facts: string }

const MAX_AREAS = 5;
const MAX_PHRASES = 5;

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800); } catch { /* text is visible */ }
      }}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? 'הועתק' : label}
    </button>
  );
}

function BusinessPlan({ b }: { b: Saved }) {
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [type, setType] = useState('');
  const [areas, setAreas] = useState<string[]>([]);
  const [areaInput, setAreaInput] = useState('');
  const [phrases, setPhrases] = useState<string[]>([]);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [facts, setFacts] = useState('');
  const [kits, setKits] = useState<Kit[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await authFetch(`/api/seo/businesses/${encodeURIComponent(b.id)}/plan`);
      const body = await r.json().catch(() => ({}));
      if (r.status === 503) { setUnavailable(true); return; }
      if (!r.ok) { setMsg(body.error ?? 'הטעינה נכשלה.'); return; }
      const s: Settings = body.settings;
      setType(s.businessType); setAreas(s.serviceAreas); setPhrases(s.phrases); setFacts(s.facts);
      setKits(body.kits ?? []);
    } catch { setMsg('הטעינה נכשלה. בדקו את החיבור.'); }
    finally { setLoaded(true); }
  }, [b.id]);
  useEffect(() => { load(); }, [load]);

  const touch = () => { setDirty(true); setMsg(null); };

  function addArea() {
    const v = areaInput.replace(/,/g, ' ').trim();
    if (v.length >= 2 && !areas.includes(v) && areas.length < MAX_AREAS) { setAreas([...areas, v]); touch(); }
    setAreaInput('');
  }

  async function suggest() {
    setBusy('suggest'); setMsg(null);
    try {
      const r = await authFetch('/api/seo/phrases/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessType: type, serviceAreas: areas }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(body.error ?? 'ההצעה נכשלה.'); return; }
      setSuggested(body.phrases ?? []);
    } catch { setMsg('ההצעה נכשלה. בדקו את החיבור.'); }
    finally { setBusy(null); }
  }

  function togglePhrase(p: string) {
    setPhrases(prev => prev.includes(p) ? prev.filter(x => x !== p) : prev.length < MAX_PHRASES ? [...prev, p] : prev);
    touch();
  }

  async function save() {
    setBusy('save'); setMsg(null);
    try {
      const r = await authFetch(`/api/seo/businesses/${encodeURIComponent(b.id)}/plan`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessType: type, serviceAreas: areas, phrases, facts }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(body.error ?? 'השמירה נכשלה.'); return; }
      setDirty(false); setMsg('נשמר.');
    } catch { setMsg('השמירה נכשלה. בדקו את החיבור.'); }
    finally { setBusy(null); }
  }

  async function generate(phrase: string) {
    setBusy(`gen:${phrase}`); setMsg(null);
    try {
      const r = await authFetch(`/api/seo/businesses/${encodeURIComponent(b.id)}/content-kits`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phrase }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(body.error ?? 'היצירה נכשלה.'); return; }
      setKits(prev => [body.kit, ...prev]);
    } catch { setMsg('היצירה נכשלה. בדקו את החיבור.'); }
    finally { setBusy(null); }
  }

  async function removeKit(id: string) {
    try {
      const r = await authFetch(`/api/seo/businesses/${encodeURIComponent(b.id)}/content-kits/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (r.ok) setKits(prev => prev.filter(k => k.id !== id));
    } catch { /* leave as is */ }
  }

  if (!loaded && !unavailable) return <div className="text-sm text-slate-400">טוענים…</div>;
  if (unavailable) return <p className="text-sm text-slate-500">תוכנית התוכן תופעל בקרוב.</p>;

  const canSuggest = type.trim().length >= 2 && areas.length > 0 && busy === null;
  const input = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-[#2E63F6] focus:outline-none';

  return (
    <div className="rounded-lg border border-slate-200 p-4 flex flex-col gap-5">
      <div className="font-semibold text-slate-900">{b.name}</div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <RoleTag who="you" /> לספר לנו על העסק ועל האזורים שאתם משרתים
        </div>
        <label className="text-xs text-slate-600">תחום העסק (למשל: אינסטלטור, מוסך, קוסמטיקאית)
          <input className={`${input} mt-1`} maxLength={40} value={type} onChange={e => { setType(e.target.value); touch(); }} />
        </label>
        <div className="text-xs text-slate-600">אזורי שירות (עד {MAX_AREAS}, לחצו Enter אחרי כל אחד)
          <div className="mt-1 flex flex-wrap gap-2">
            {areas.map(a => (
              <span key={a} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                {a}
                <button type="button" aria-label={`הסרת ${a}`} onClick={() => { setAreas(areas.filter(x => x !== a)); touch(); }}><X size={12} /></button>
              </span>
            ))}
            {areas.length < MAX_AREAS && (
              <input
                className="min-w-[8rem] flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-[#2E63F6] focus:outline-none"
                maxLength={30}
                placeholder="עיר או אזור"
                value={areaInput}
                onChange={e => setAreaInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addArea(); } }}
                onBlur={addArea}
              />
            )}
          </div>
        </div>
        <label className="text-xs text-slate-600">
          מה חשוב לדעת על העסק? (שירותים, מה מייחד אתכם, שעות או מחירים אם תרצו שיופיעו). רק מה שתכתבו כאן ייכנס לתוכן.
          <textarea className={`${input} mt-1`} rows={4} maxLength={1500} value={facts} onChange={e => { setFacts(e.target.value); touch(); }} />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <RoleTag who="we" /> מציעים ביטויי חיפוש שמתאימים לעסק ולאזור
        </div>
        <button
          type="button" disabled={!canSuggest} onClick={suggest}
          className="self-start rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy === 'suggest' ? 'מציעים…' : 'הציעו לי ביטויים'}
        </button>
        {(suggested.length > 0 || phrases.length > 0) && (
          <ul className="flex flex-col gap-1">
            {Array.from(new Set([...phrases, ...suggested])).map(p => (
              <li key={p}>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={phrases.includes(p)} onChange={() => togglePhrase(p)} />
                  {p}
                </label>
              </li>
            ))}
          </ul>
        )}
        {phrases.length >= MAX_PHRASES && <p className="text-xs text-slate-500">בחרתם {MAX_PHRASES} ביטויים, זה המקסימום.</p>}
        <div className="flex items-center gap-3">
          <button
            type="button" disabled={busy !== null || !dirty || !canSuggest} onClick={save}
            className="rounded-lg bg-[#2E63F6] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy === 'save' ? 'שומרים…' : 'שמירה'}
          </button>
          {msg && <span className="text-xs text-slate-600">{msg}</span>}
        </div>
      </div>

      {phrases.length > 0 && !dirty && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <RoleTag who="we" /> כותבים תוכן מוכן להעתקה לאתר שלכם
          </div>
          <p className="text-xs text-slate-500">
            התוכן נכתב רק ממה שמסרתם. בדקו אותו לפני פרסום. מספרים שלא מסרתם מוסרים אוטומטית.
          </p>
          {phrases.map(p => (
            <div key={p} className="flex items-center justify-between gap-2 text-sm text-slate-700">
              <span>{p}</span>
              <button
                type="button" disabled={busy !== null} onClick={() => generate(p)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {busy === `gen:${p}` ? <><Loader2 size={14} className="animate-spin" /> כותבים…</> : 'יצירת תוכן'}
              </button>
            </div>
          ))}
        </div>
      )}

      {kits.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <RoleTag who="you" /> להדביק באתר שלכם (כותרת, תיאור וגוף העמוד)
          </div>
          {kits.map(k => (
            <details key={k.id} className="rounded-lg border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-800">{k.phrase}</summary>
              <div className="mt-3 flex flex-col gap-2 text-sm text-slate-700">
                <div><span className="text-xs text-slate-500">כותרת העמוד (title): </span>{k.kit.title}</div>
                {k.kit.metaDescription && <div><span className="text-xs text-slate-500">תיאור (meta): </span>{k.kit.metaDescription}</div>}
                {k.kit.dropped > 0 && (
                  <p className="text-xs text-amber-700">הוסרו {k.kit.dropped} משפטים שהכילו מספרים שלא מסרתם.</p>
                )}
                <pre dir="rtl" className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{k.text}</pre>
                <div className="flex flex-wrap gap-2">
                  <CopyBtn text={k.text} label="העתקת טקסט" />
                  <CopyBtn text={k.html} label="העתקת HTML (כולל FAQ)" />
                  <button
                    type="button" onClick={() => removeKit(k.id)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
                  >
                    <Trash2 size={14} /> מחיקה
                  </button>
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ContentPlanCard() {
  const [list, setList] = useState<Saved[] | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await authFetch('/api/seo/businesses');
      if (!r.ok) { setList([]); return; }
      const body = await r.json().catch(() => ({}));
      setList(body.businesses ?? []);
    } catch { setList([]); }
  }, []);
  useEffect(() => {
    load();
    window.addEventListener('seo-businesses-changed', load);
    return () => window.removeEventListener('seo-businesses-changed', load);
  }, [load]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col gap-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">תוכן לחיפושים ספציפיים</h3>
        <p className="mt-1 text-sm text-slate-500">
          לקוחות מחפשים בצורה מפורטת, למשל "אינסטלטור בחיפה". אנחנו מציעים את הביטויים וכותבים להם תוכן, ואתם מוסיפים אותו לאתר.
        </p>
      </div>
      {list === null ? null : list.length === 0 ? (
        <p className="text-sm text-slate-500">חברו קודם את העסק שלכם בבדיקה למעלה.</p>
      ) : (
        list.map(b => <BusinessPlan key={b.id} b={b} />)
      )}
    </div>
  );
}
