import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowLeft, Lock, Merge, RefreshCw, Sparkles, X } from 'lucide-react';
import { Notice } from './bits';
import { HINT, POLISH } from './polishCopy';
import { DESC_MAX, descriptionHints, servicesHints, type Hint } from './polishCheck';
import type { FieldValues, PolishField, PolishRequest, PolishResult, PolishedService, ServiceItem } from './profileTypes';
import './dashboard-v3-polish.css';

// "שיפור הניסוח" (README part 144): one click, ONE strong suggestion shown as before/after. The owner can
// edit it, ask once more ("ניסוח אחר", up to 3 a day per field), or drop it. Nothing is saved until
// "החלפה", which goes through the field's normal save (status, pending, Google), exactly like "שמירה".

type Polish = <F extends PolishField>(field: F, req: PolishRequest<F>) => Promise<PolishResult>;

interface Props<F extends PolishField> {
  field: F;
  /** what the owner has now: the editor's draft while editing, else the saved value */
  current: FieldValues[F];
  polish: Polish;
  /** saves the accepted value; null = saved, otherwise the sentence to show */
  onAccept: (value: FieldValues[F]) => Promise<string | null>;
  /** the places the business works in, for the hints */
  areas: string[];
  label: string;
  disabled?: boolean;
}

/** The button next to the field, and the dialog it opens. */
export function PolishButton<F extends PolishField>(p: Props<F>) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    // back to where the owner was (the button may be gone after a save: then the browser keeps its place)
    window.setTimeout(() => { if (btn.current?.isConnected) btn.current.focus(); }, 0);
  }, []);
  return (
    <>
      <button ref={btn} type="button" className="dv3-btn dv3-btn-ghost dv3-a-small dv3-pol-trigger" disabled={p.disabled} aria-haspopup="dialog" aria-label={POLISH.buttonLabel(p.label)} onClick={() => setOpen(true)}>
        <Sparkles size={16} aria-hidden /> {POLISH.button}
      </button>
      {open && <PolishDialog {...p} onClose={close} />}
    </>
  );
}

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), [href], [tabindex]:not([tabindex="-1"])';

function hintText(h: Hint): string { return HINT[h.code]; }

function PolishDialog<F extends PolishField>({ field, current, polish, onAccept, areas, onClose }: Props<F> & { onClose: () => void }) {
  const titleId = useId(), introId = useId(), afterId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [result, setResult] = useState<Extract<PolishResult, { ok: true }> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<FieldValues[F][]>([]);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<PolishedService[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [live, setLive] = useState('');
  const started = useRef(false);

  const ask = useCallback(async (previous: FieldValues[F][]) => {
    setPhase('loading'); setMessage(null); setAcceptError(null); setLive(POLISH.loading);
    const r = await polish(field, { draft: current, previous });
    if (!r.ok) {
      setMessage(r.message);
      setLive(r.message);
      // a limit after a suggestion keeps that suggestion on screen
      setPhase((ph) => (result ? 'ready' : ph === 'loading' ? 'error' : ph));
      if (result) setResult({ ...result, remaining: 0 });
      return;
    }
    setResult(r);
    if (r.field === 'description') { setText(r.suggestion); setHistory((h) => [...h, r.suggestion as FieldValues[F]]); }
    else { setRows(r.suggestion.map((s) => ({ ...s }))); setPicked([]); setHistory((h) => [...h, r.suggestion.map(({ name, description }) => ({ name, description })) as FieldValues[F]]); }
    setPhase('ready');
    setLive(r.unchanged ? POLISH.unchanged : POLISH.ready);
  }, [polish, field, current, result]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    title.current?.focus();
    void ask([]);
  }, [ask]);

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

  const descHints = field === 'description' && phase === 'ready' ? descriptionHints(text, areas) : [];
  const rowHints = field === 'services' && phase === 'ready' ? servicesHints(rows) : [];
  const blocking = descHints.filter((h) => h.level === 'error');
  const emptyRow = field === 'services' && rows.some((r) => r.name.trim().length < 2);

  const accept = async () => {
    if (blocking.length || emptyRow) { setAcceptError(POLISH.fixFirst); return; }
    const value = (field === 'description'
      ? text.trim()
      : [...rows.map(({ name, description }) => ({ name: name.trim(), description: description.trim() })), ...picked.map((name) => ({ name, description: '' }))]) as FieldValues[F];
    setBusy(true); setAcceptError(null);
    const err = await onAccept(value);
    setBusy(false);
    if (err) { setAcceptError(err); return; }
    onClose();
  };

  const remaining = result?.remaining ?? 0;
  const before = result ? result.before : current;

  return (
    <div className="dv3-pol-wrap">
      <div className="dv3-pol-backdrop" aria-hidden onClick={() => { if (!busy) onClose(); }} />
      <div ref={panel} className="dv3-pol" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={introId} onKeyDown={onKey}>
        <div className="dv3-pol-head">
          <h2 id={titleId} ref={title} tabIndex={-1}><Sparkles size={20} aria-hidden /> {POLISH.title[field]}</h2>
          <button type="button" className="dv3-pol-x" aria-label={POLISH.close} disabled={busy} onClick={onClose}><X size={22} aria-hidden /></button>
        </div>
        <div className="dv3-pol-body">
          <p id={introId} className="dv3-a-hint dv3-pol-intro">{POLISH.intro[field]}</p>
          <p className="sr-only" aria-live="polite" role="status">{live}</p>

          {phase === 'loading' && (
            <div className="dv3-pol-loading" aria-hidden>
              <span className="dv3-a-spinner" />
              <p>{POLISH.loading}</p>
              <div className="dv3-pol-shimmer"><i /><i /><i /><i /></div>
            </div>
          )}

          {phase === 'error' && message && <Notice kind="error">{message}</Notice>}

          {phase === 'ready' && result && (
            <>
              {result.unchanged && <Notice kind="info">{POLISH.unchanged}</Notice>}
              <div className="dv3-pol-compare" data-field={field}>
                <section className="dv3-pol-before" aria-label={POLISH.before}>
                  <h3>{POLISH.before}</h3>
                  {field === 'description'
                    ? <BeforeText text={before as string} />
                    : <BeforeList list={before as ServiceItem[]} />}
                </section>
                <div className="dv3-pol-arrow" aria-hidden><ArrowLeft size={22} /></div>
                <section className="dv3-pol-after" aria-labelledby={afterId}>
                  <h3 id={afterId}>{POLISH.after}</h3>
                  {field === 'description' ? (
                    <>
                      <textarea className="dv3-a-input dv3-pol-text" aria-label={POLISH.afterEditLabel} rows={9} maxLength={DESC_MAX + 200} value={text} onChange={(e) => { setText(e.target.value); setAcceptError(null); }} />
                      <div className="dv3-pol-meta">
                        <span className="dv3-a-hint">{POLISH.aim}</span>
                        <span className="dv3-a-counter" data-over={text.trim().length > DESC_MAX ? 'yes' : undefined}>{POLISH.counter(text.trim().length)}</span>
                      </div>
                      <HintList hints={descHints} />
                    </>
                  ) : (
                    <ServiceRows rows={rows} before={before as ServiceItem[]} onChange={(r) => { setRows(r); setAcceptError(null); }} />
                  )}
                </section>
              </div>
              {field === 'services' && rowHints.some((h) => h.code === 'dup') && <HintList hints={rowHints.filter((h) => h.code === 'dup').slice(0, 1)} />}
              {field === 'services' && result.field === 'services' && result.forgotten.length > 0 && (
                <fieldset className="dv3-pol-forgot">
                  <legend>{POLISH.forgottenTitle}</legend>
                  <p className="dv3-a-hint">{POLISH.forgottenHint}</p>
                  {result.forgotten.map((f) => (
                    <label key={f} className="dv3-p-check">
                      <input type="checkbox" checked={picked.includes(f)} onChange={(e) => setPicked((l) => (e.target.checked ? [...l, f] : l.filter((x) => x !== f)))} />
                      <span>{f}</span>
                    </label>
                  ))}
                </fieldset>
              )}
              {message && <Notice kind="info">{message}</Notice>}
              {remaining === 0 && !message && <p className="dv3-a-hint">{POLISH.noMoreToday}</p>}
            </>
          )}
          <div aria-live="assertive">{acceptError && <Notice kind="error">{acceptError}</Notice>}</div>
        </div>
        <div className="dv3-pol-foot">
          {phase !== 'error' && <button type="button" className="dv3-btn dv3-a-small" disabled={phase !== 'ready' || busy} onClick={() => void accept()}>{busy ? POLISH.replacing : POLISH.replace}</button>}
          {phase !== 'loading' && remaining > 0 && (
            <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" disabled={busy} onClick={() => void ask(history)}>
              <RefreshCw size={16} aria-hidden /> {POLISH.anotherLeft(remaining)}
            </button>
          )}
          <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small dv3-pol-cancel" disabled={busy} onClick={onClose}>{phase === 'error' ? POLISH.close : POLISH.cancel}</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The tiny quality hint under the owner's own description or services ("התיאור קצר מדי", "חסר האזור").
 * At most two lines, never blocking.
 */
export function PolishHints<F extends PolishField>({ field, value, areas }: { field: F; value: FieldValues[F] | null; areas: string[] }) {
  if (value === null) return null;
  const all = field === 'description' ? descriptionHints(value as string, areas) : servicesHints(value as ServiceItem[]);
  // one line per kind of hint, the ones Google would refuse first
  const seen = new Set<string>();
  const hints = [...all].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1)).filter((h) => (seen.has(h.code) ? false : (seen.add(h.code), true))).slice(0, 2);
  if (!hints.length) return null;
  return (
    <div className="dv3-pol-own">
      <HintList hints={hints} />
      <p className="dv3-a-hint dv3-pol-own-try">{HINT.tryPolish}</p>
    </div>
  );
}

function BeforeText({ text }: { text: string }) {
  if (!text.trim()) return <p className="dv3-p-empty">{POLISH.emptyBefore}</p>;
  return (
    <>
      <p className="dv3-pol-beforetext">{text}</p>
      <span className="dv3-a-counter">{POLISH.counter(text.trim().length)}</span>
    </>
  );
}

function BeforeList({ list }: { list: ServiceItem[] }) {
  return (
    <ol className="dv3-pol-list">
      {list.map((s, i) => <li key={`${s.name}-${i}`}><span className="dv3-pol-name">{s.name}</span>{s.description && <span className="dv3-pol-desc">{s.description}</span>}</li>)}
    </ol>
  );
}

function HintList({ hints }: { hints: Hint[] }) {
  if (!hints.length) return null;
  return (
    <ul className="dv3-pol-hints">
      {hints.map((h, i) => <li key={`${h.code}-${i}`} data-level={h.level}>{hintText(h)}</li>)}
    </ul>
  );
}

function ServiceRows({ rows, before, onChange }: { rows: PolishedService[]; before: ServiceItem[]; onChange: (r: PolishedService[]) => void }) {
  const set = (i: number, p: Partial<PolishedService>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <ol className="dv3-pol-rows">
      {rows.map((r, i) => {
        const merged = r.from.length > 1 ? r.from.map((f) => before[f]?.name).filter(Boolean) as string[] : [];
        return (
          <li key={i} className="dv3-pol-row">
            <input className="dv3-a-input" aria-label={POLISH.nameLabel(i + 1)} value={r.name} maxLength={60} readOnly={r.locked} aria-describedby={r.locked ? `pol-lock-${i}` : undefined} onChange={(e) => set(i, { name: e.target.value })} />
            <input className="dv3-a-input" aria-label={POLISH.descLabel(r.name)} placeholder={POLISH.descPlaceholder} value={r.description} maxLength={120} onChange={(e) => set(i, { description: e.target.value })} />
            {(r.locked || merged.length > 0) && (
              <p className="dv3-pol-tags">
                {r.locked && <span id={`pol-lock-${i}`} className="dv3-pol-tag" title={POLISH.lockedWhy}><Lock size={12} aria-hidden /> {POLISH.lockedName}</span>}
                {merged.length > 0 && <span className="dv3-pol-tag dv3-pol-tag-merge"><Merge size={12} aria-hidden /> {POLISH.merged(merged)}</span>}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
