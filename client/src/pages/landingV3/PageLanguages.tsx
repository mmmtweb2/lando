// Page languages UI (README part 142): the visitor's language switch at the top of the page, and the owner's
// languages panel in the editor ("הוספת שפה", "עדכון התרגום", "אישור ופרסום"). Owner texts are Hebrew; the
// switch shows each language in its own name.
import { useState } from 'react';
import { Languages, Loader2, X } from 'lucide-react';
import { authFetch } from '../../lib/api';
import { LANGUAGES, SOURCE_LANG, TRANSLATION_LANGS, langPath, type LangCode } from '../../i18n/landingLanguages';

export interface PageTranslation {
  lang: string;
  status: 'draft' | 'published';
  content: Record<string, string>;
  /** owner only */
  manual_keys?: string[];
  stale_keys?: string[];
  total_keys?: number;
  updated_at?: string | null;
  approved_at?: string | null;
}

// ─── Visitor switch ───────────────────────────────────────────────────────────

/** Links to every language this viewer may see. Real links (with hreflang), so they work without script too. */
export function LangSwitch({ current, langs, base, label, onPick }: {
  current: string; langs: string[]; base: string; label: string; onPick: (lang: string, href: string) => void;
}) {
  if (langs.length < 2) return null;
  return (
    <nav className="lsw" aria-label={label}>
      {langs.map((l) => {
        const cfg = LANGUAGES[l as LangCode];
        const href = langPath(base, l);
        const on = l === current;
        return (
          <a key={l} href={href} lang={l} hrefLang={l} aria-current={on ? 'page' : undefined} className={on ? 'on' : undefined}
            onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); onPick(l, href); }}>
            <span className="full">{cfg.native}</span><span className="short" aria-hidden="true">{cfg.short}</span>
          </a>
        );
      })}
    </nav>
  );
}

// ─── Owner panel ──────────────────────────────────────────────────────────────

const staleText = (n: number) => (n === 1 ? 'טקסט אחד לא מעודכן' : `${n} טקסטים לא מעודכנים`);

interface PanelProps {
  pageId: string;
  ready: boolean;
  translations: PageTranslation[];
  current: string;
  isHealth: boolean;
  /** show the round button and the panel (edit mode) */
  editing: boolean;
  onChange: (t: PageTranslation[]) => void;
  onGo: (lang: string) => void;
}

type Conflict = { lang: string; items: Array<{ key: string; source: string; current: string }> };

export function LanguagePanel({ pageId, ready, translations, current, isHealth, editing, onChange, onGo }: PanelProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approve, setApprove] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  if (!ready) return null; // migration 054 has not run: the feature is not there yet

  const have = new Set(translations.map((t) => t.lang));
  const addable = TRANSLATION_LANGS.filter((l) => !have.has(l));
  const cur = translations.find((t) => t.lang === current) ?? null;

  async function call(url: string, init: RequestInit, tag: string): Promise<Response | null> {
    setBusy(tag);
    setError(null);
    try {
      const r = await authFetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
      const body = await r.clone().json().catch(() => ({})) as { translations?: PageTranslation[]; error?: string };
      if (r.ok && body.translations) onChange(body.translations);
      else if (!r.ok && r.status !== 409) setError(body.error ?? 'הפעולה לא הצליחה. נסו שוב.');
      return r;
    } catch {
      setError('הפעולה לא הצליחה. נסו שוב.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function add(lang: string) {
    const r = await call(`/api/landing/${pageId}/translations`, { method: 'POST', body: JSON.stringify({ lang }) }, `add:${lang}`);
    if (r?.ok) { setOpen(false); onGo(lang); }
  }

  async function refresh(lang: string, manual?: 'overwrite' | 'keep') {
    const r = await call(`/api/landing/${pageId}/translations/${lang}/refresh`, { method: 'POST', body: JSON.stringify(manual ? { manual } : {}) }, `refresh:${lang}`);
    if (r?.status === 409) {
      const b = await r.json().catch(() => ({})) as { items?: Conflict['items'] };
      setConflict({ lang, items: b.items ?? [] });
    } else if (r?.ok) setConflict(null);
  }

  async function publish(lang: string) {
    const r = await call(`/api/landing/${pageId}/translations/${lang}/publish`, { method: 'POST' }, `publish:${lang}`);
    if (r?.ok) setApprove(null);
  }

  async function remove(lang: string) {
    if (!window.confirm(`להסיר את הגרסה ב${LANGUAGES[lang as LangCode].heName} מהדף? אפשר להוסיף אותה שוב בכל זמן.`)) return;
    const r = await call(`/api/landing/${pageId}/translations/${lang}`, { method: 'DELETE' }, `remove:${lang}`);
    if (r?.ok && current === lang) onGo(SOURCE_LANG);
  }

  const approveTr = approve ? translations.find((t) => t.lang === approve) : null;

  return (
    <>
      {/* The language this page is being viewed in, for the owner: status, and what is out of date */}
      {cur && (
        <div className="fixed bottom-[5.5rem] inset-x-0 z-40 flex justify-center px-3 pointer-events-none" dir="rtl">
          <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-2xl border border-slate-200 bg-white/95 px-4 py-2 text-sm text-slate-700 shadow-lg backdrop-blur-md">
            <span>הגרסה ב<b>{LANGUAGES[cur.lang as LangCode].heName}</b></span>
            {cur.status === 'draft'
              ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">טיוטה, רק אתם רואים אותה</span>
              : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">מפורסמת</span>}
            {(cur.stale_keys?.length ?? 0) > 0 && (
              <>
                <span className="font-semibold text-amber-700">{staleText(cur.stale_keys!.length)}</span>
                <button type="button" onClick={() => { void refresh(cur.lang); }} disabled={!!busy}
                  className="min-h-[36px] rounded-lg bg-slate-800 px-3 text-xs font-bold text-white disabled:opacity-60">
                  {busy === `refresh:${cur.lang}` ? 'מעדכנים…' : 'עדכון התרגום'}
                </button>
              </>
            )}
            {cur.status === 'draft' && (
              <button type="button" onClick={() => setApprove(cur.lang)}
                className="min-h-[36px] rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white">אישור ופרסום</button>
            )}
          </div>
        </div>
      )}

      {editing && (
        <button
          onClick={() => setOpen((v) => !v)}
          title="שפות הדף"
          aria-label="פתיחת שפות הדף"
          className="fixed top-20 right-[10.75rem] z-50 w-11 h-11 rounded-full bg-white/95 backdrop-blur-md border border-slate-200 shadow-lg flex items-center justify-center text-slate-600 hover:scale-105 transition"
        >
          <Languages size={18} />
        </button>
      )}
      {editing && open && (
        <div className="fixed top-[4.75rem] right-4 z-50 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200 shadow-xl p-4 flex flex-col gap-3" dir="rtl">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-700">שפות הדף</p>
            <button onClick={() => setOpen(false)} aria-label="סגירה" className="w-5 h-5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs leading-none">×</button>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">כל שפה עולה לאוויר יחד עם הדף. עברו עליה ב&quot;הצגה ועריכה&quot; כמו שאתם עוברים על הדף בעברית, ותקנו ישירות בדף מה שצריך.</p>
          <ul className="flex flex-col gap-2">
            <li className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <span><b>עברית</b> <span className="text-slate-400">(המקור)</span></span>
              {current !== SOURCE_LANG && <button onClick={() => onGo(SOURCE_LANG)} className="text-xs font-bold text-slate-600 underline underline-offset-4">הצגה</button>}
            </li>
            {translations.map((t) => {
              const stale = t.stale_keys?.length ?? 0;
              return (
                <li key={t.lang} className="flex flex-col gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span><b>{LANGUAGES[t.lang as LangCode].heName}</b> <span className={t.status === 'draft' ? 'text-amber-700' : 'text-emerald-700'}>· {t.status === 'draft' ? 'טיוטה' : 'פעילה'}</span></span>
                    {current !== t.lang && <button onClick={() => onGo(t.lang)} className="text-xs font-bold text-slate-600 underline underline-offset-4">הצגה ועריכה</button>}
                  </div>
                  {stale > 0 && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-amber-700">{staleText(stale)}</span>
                      <button onClick={() => { void refresh(t.lang); }} disabled={!!busy} className="whitespace-nowrap text-xs font-bold text-slate-800 underline underline-offset-4 disabled:opacity-60">
                        {busy === `refresh:${t.lang}` ? 'מעדכנים…' : 'עדכון התרגום'}
                      </button>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    {t.status === 'draft'
                      ? <button onClick={() => setApprove(t.lang)} className="text-xs font-bold text-emerald-700 underline underline-offset-4">אישור ופרסום</button>
                      : <span />}
                    <button onClick={() => { void remove(t.lang); }} disabled={!!busy} className="text-xs text-slate-400 hover:text-red-600">הסרה</button>
                  </div>
                </li>
              );
            })}
          </ul>
          {addable.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-bold text-slate-700">הוספת שפה</p>
              <div className="flex flex-wrap gap-2">
                {addable.map((l) => (
                  <button key={l} onClick={() => { void add(l); }} disabled={!!busy}
                    className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                    {busy === `add:${l}` ? <Loader2 size={14} className="animate-spin" /> : '+'} {LANGUAGES[l].heName}
                  </button>
                ))}
              </div>
              {busy?.startsWith('add:')
                ? <p className="text-[11px] text-slate-500 leading-snug">מתרגמים את כל הדף. זה לוקח כחצי דקה.</p>
                : <p className="text-[11px] text-slate-400 leading-snug">כל הדף מתורגם בלחיצה אחת, ויש לו כתובת משלו. אפשר לערוך כל טקסט אחר כך.{isHealth ? ' בדף של מרפאה הגרסה החדשה נשמרת כטיוטה עד שתאשרו אותה.' : ''}</p>}
            </div>
          )}
          {error && <p className="text-[11px] text-red-500 leading-tight">{error}</p>}
        </div>
      )}

      {/* "אישור ופרסום": the whole translation, with a clear note, before a medical page goes live in another language */}
      {approveTr && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="lang-approve-h">
          <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <h2 id="lang-approve-h" className="text-lg font-bold text-slate-800">אישור הגרסה ב{LANGUAGES[approveTr.lang as LangCode].heName}</h2>
                <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">
                  זה טקסט רפואי בשפה אחרת. לפני הפרסום, כדאי שמישהו שקורא {LANGUAGES[approveTr.lang as LangCode].heName} יעבור עליו. אפשר לתקן כל טקסט ישירות בדף.
                </p>
              </div>
              <button onClick={() => setApprove(null)} aria-label="סגירה" className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <ol className="flex-1 overflow-y-auto p-5 text-sm leading-relaxed text-slate-700" dir={LANGUAGES[approveTr.lang as LangCode].dir} lang={approveTr.lang}>
              {Object.entries(approveTr.content).filter(([k]) => !k.startsWith('img_alt:')).map(([k, v]) => (
                <li key={k} className="border-b border-slate-100 py-2 last:border-0">{v}</li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2 border-t border-slate-100 p-4">
              <button onClick={() => { void publish(approveTr.lang); }} disabled={!!busy}
                className="min-h-[44px] flex-1 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-60">
                {busy?.startsWith('publish:') ? 'מפרסמים…' : 'אישור ופרסום'}
              </button>
              <button onClick={() => setApprove(null)} className="min-h-[44px] rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600">לא עכשיו</button>
            </div>
          </div>
        </div>
      )}

      {/* Texts the owner rewrote by hand whose Hebrew changed: never overwritten without asking */}
      {conflict && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="lang-conflict-h">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 p-5">
              <h2 id="lang-conflict-h" className="text-lg font-bold text-slate-800">טקסטים שכתבתם בעצמכם</h2>
              <p className="mt-1 text-sm text-slate-600">הטקסטים האלה השתנו בעברית, ואת הגרסה ב{LANGUAGES[conflict.lang as LangCode].heName} כתבתם בעצמכם. לתרגם אותם מחדש? הנוסח שלכם יוחלף.</p>
            </div>
            <ul className="flex-1 overflow-y-auto p-5 text-sm">
              {conflict.items.map((it) => (
                <li key={it.key} className="border-b border-slate-100 py-2 last:border-0">
                  <p className="text-slate-500">{it.source}</p>
                  <p className="mt-1 font-semibold text-slate-800" dir={LANGUAGES[conflict.lang as LangCode].dir}>{it.current}</p>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2 border-t border-slate-100 p-4">
              <button onClick={() => { void refresh(conflict.lang, 'overwrite'); }} disabled={!!busy} className="min-h-[44px] flex-1 rounded-xl bg-slate-800 px-4 text-sm font-bold text-white disabled:opacity-60">לתרגם גם אותם</button>
              <button onClick={() => { void refresh(conflict.lang, 'keep'); }} disabled={!!busy} className="min-h-[44px] flex-1 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 disabled:opacity-60">להשאיר את הנוסח שלי</button>
              <button onClick={() => setConflict(null)} className="min-h-[44px] rounded-xl px-4 text-sm font-semibold text-slate-500">ביטול</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
