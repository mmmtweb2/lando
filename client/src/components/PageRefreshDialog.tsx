import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, Loader2, RefreshCw, X } from 'lucide-react';
import { REFRESH, serverRefreshApi, type RefreshApi, type RefreshApplied, type RefreshLine, type RefreshPreview, type RefreshSectionId } from '../lib/pageRefresh';

// "עדכון הדף לפי פרטי העסק" (README part 146). One click writes new texts from the current business card; the
// owner sees every changed section as before/after, unticks what should stay, and "החלפה" saves only the ticked
// ones. "ביטול" (or Escape, or the backdrop) drops the whole thing: nothing on the page changes before "החלפה".

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

interface ButtonProps {
  pageId: string;
  onApplied: (r: RefreshApplied) => void;
  api?: RefreshApi;
  /** unsaved edits in the editor: the button explains instead of opening */
  blockedReason?: string | null;
  className?: string;
  short?: boolean;
  /** a round icon button (the editor's floating tools on a phone); the words go to aria-label */
  iconOnly?: boolean;
}

/** The button (editor toolbar, dashboard page card) and the dialog it opens. */
export function PageRefreshButton({ pageId, onApplied, api, blockedReason, className, short, iconOnly }: ButtonProps) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(() => { if (btn.current?.isConnected) btn.current.focus(); }, 0);
  }, []);
  return (
    <>
      <button ref={btn} type="button" aria-haspopup="dialog" disabled={!!blockedReason}
        title={blockedReason ?? REFRESH.buttonHint} aria-label={iconOnly ? REFRESH.button : undefined}
        className={className ?? 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition'}
        onClick={() => setOpen(true)}>
        <RefreshCw size={iconOnly ? 18 : 12} aria-hidden />
        {iconOnly ? null : short ? REFRESH.buttonShort : REFRESH.button}
      </button>
      {/* In a portal: the editor toolbar has a backdrop blur, which would trap a fixed dialog inside the toolbar. */}
      {open && createPortal(<PageRefreshDialog pageId={pageId} api={api ?? serverRefreshApi} onClose={close} onApplied={onApplied} />, document.body)}
    </>
  );
}

function Lines({ lines, dim }: { lines: RefreshLine[]; dim?: boolean }) {
  if (!lines.length) return <p className="text-sm text-slate-400">{REFRESH.empty}</p>;
  return (
    <ul className={`flex flex-col gap-2 ${dim ? 'opacity-60' : ''}`}>
      {lines.map((l, i) => (
        <li key={i} className="text-sm leading-relaxed text-slate-700 break-words">
          {l.title && <span className="block font-semibold text-slate-900">{l.title}</span>}
          {l.text && <span className="block whitespace-pre-line">{l.text}</span>}
        </li>
      ))}
    </ul>
  );
}

export function PageRefreshDialog({ pageId, api, onClose, onApplied }: { pageId: string; api: RefreshApi; onClose: () => void; onApplied: (r: RefreshApplied) => void }) {
  const titleId = useId(), introId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'nothing' | 'error'>('loading');
  const [preview, setPreview] = useState<RefreshPreview | null>(null);
  const [picked, setPicked] = useState<Set<RefreshSectionId>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<string>(REFRESH.loading);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    title.current?.focus();
    void (async () => {
      const r = await api.preview(pageId);
      if (!r.ok) { setMessage(r.message); setLive(r.message); setPhase('error'); return; }
      setPreview(r.data);
      if (!r.data.sections.length) { setPhase('nothing'); setLive(REFRESH.nothing); return; }
      setPicked(new Set(r.data.sections.map((s) => s.id)));
      setPhase('ready');
      setLive(REFRESH.ready(r.data.sections.length));
    })();
  }, [api, pageId]);

  // the page behind does not scroll while the dialog is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !panel.current) return;
    const list = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === title.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const toggle = (id: RefreshSectionId, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const total = preview?.sections.length ?? 0;
  const allOn = picked.size === total;

  const apply = async () => {
    if (!preview || !picked.size) return;
    setBusy(true); setMessage(null); setLive(REFRESH.replacing);
    const order = preview.sections.map((s) => s.id).filter((id) => picked.has(id));
    const r = await api.apply(pageId, preview.token, order);
    setBusy(false);
    if (!r.ok) { setMessage(r.message); setLive(r.message); return; }
    onApplied(r.data);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-center sm:items-center sm:p-6" dir="rtl">
      <div className="absolute inset-0 bg-slate-900/50" aria-hidden onClick={() => { if (!busy) onClose(); }} />
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={introId} onKeyDown={onKey}
        className="relative flex w-full flex-col bg-white shadow-2xl sm:max-h-[90vh] sm:max-w-4xl sm:rounded-2xl"
        style={{ fontFamily: 'Assistant, Rubik, system-ui, sans-serif' }}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <h2 id={titleId} ref={title} tabIndex={-1} className="flex items-center gap-2 text-lg font-bold text-slate-900 outline-none">
            <RefreshCw size={18} aria-hidden className="text-slate-500" /> {REFRESH.title}
          </h2>
          <button type="button" aria-label={REFRESH.close} disabled={busy} onClick={onClose}
            className="-m-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-50">
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p id={introId} className="text-sm leading-relaxed text-slate-600">{REFRESH.intro}</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{REFRESH.untouched}</p>
          <p className="sr-only" role="status" aria-live="polite">{live}</p>

          {phase === 'loading' && (
            <div className="mt-6 flex flex-col items-center gap-3 py-10 text-center" aria-hidden>
              <Loader2 size={28} className="animate-spin text-slate-400" />
              <p className="text-sm text-slate-600">{REFRESH.loading}</p>
              <div className="mt-2 flex w-full max-w-md flex-col gap-2">
                {[0, 1, 2].map((i) => <div key={i} className="h-3 animate-pulse rounded bg-slate-100" style={{ width: `${90 - i * 15}%` }} />)}
              </div>
            </div>
          )}

          {phase === 'error' && message && (
            <p className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{message}</p>
          )}

          {phase === 'nothing' && (
            <p className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{REFRESH.nothing}</p>
          )}

          {phase === 'ready' && preview && (
            <>
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-slate-800">{REFRESH.summary(picked.size, total)}</p>
                <button type="button" className="min-h-[44px] px-2 text-sm font-semibold text-slate-600 underline underline-offset-4 hover:text-slate-900"
                  onClick={() => setPicked(allOn ? new Set() : new Set(preview.sections.map((s) => s.id)))}>
                  {allOn ? REFRESH.selectNone : REFRESH.selectAll}
                </button>
              </div>
              <ul className="mt-2 flex flex-col gap-3">
                {preview.sections.map((s) => {
                  const on = picked.has(s.id);
                  return (
                    <li key={s.id} className={`rounded-xl border ${on ? 'border-slate-300' : 'border-slate-200 bg-slate-50/60'}`}>
                      <label className="flex min-h-[48px] cursor-pointer items-center gap-3 px-4 py-2">
                        <input type="checkbox" checked={on} onChange={(e) => toggle(s.id, e.target.checked)}
                          aria-label={REFRESH.replaceThis(s.label)} className="h-5 w-5 flex-shrink-0 accent-slate-900" />
                        <span className="flex-1 text-base font-bold text-slate-900">{s.label}</span>
                        <span className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${on ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                          {on && <Check size={12} aria-hidden />}{on ? REFRESH.willReplace : REFRESH.willKeep}
                        </span>
                      </label>
                      <div className="grid grid-cols-1 gap-3 border-t border-slate-100 px-4 py-3 md:grid-cols-[1fr_auto_1fr] md:items-start">
                        <section aria-label={`${s.label}: ${REFRESH.before}`}>
                          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{REFRESH.before}</h3>
                          <Lines lines={s.before} dim={on} />
                        </section>
                        <div className="hidden pt-6 text-slate-300 md:block" aria-hidden><ArrowLeft size={18} /></div>
                        <section aria-label={`${s.label}: ${REFRESH.after}`} className={`rounded-lg p-3 ${on ? 'bg-emerald-50/60 ring-1 ring-emerald-100' : 'bg-white'}`}>
                          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">{REFRESH.after}</h3>
                          <Lines lines={s.after} dim={!on} />
                        </section>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-slate-500">{REFRESH.remaining(preview.remaining)}</p>
            </>
          )}
          <div aria-live="assertive">
            {phase === 'ready' && message && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{message}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-start gap-2 border-t border-slate-200 px-5 py-3">
          {phase === 'ready' && (
            <button type="button" disabled={!picked.size || busy} onClick={() => void apply()}
              className="min-h-[44px] rounded-xl bg-slate-900 px-6 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? REFRESH.replacing : REFRESH.replace}
            </button>
          )}
          <button type="button" disabled={busy} onClick={onClose}
            className="min-h-[44px] rounded-xl border border-slate-200 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {phase === 'ready' || phase === 'loading' ? REFRESH.cancel : REFRESH.close}
          </button>
          {phase === 'ready' && <span className="ms-auto text-xs text-slate-500" aria-hidden>{REFRESH.summary(picked.size, total)}</span>}
        </div>
      </div>
    </div>
  );
}
