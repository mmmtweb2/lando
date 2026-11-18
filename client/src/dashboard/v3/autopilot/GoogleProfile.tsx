import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, ImagePlus, Images, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { Skeleton } from '../../ui';
import { ViewShell } from '../Views';
import HoursField from './HoursField';
import { LoadError, Notice, SampleBanner } from './bits';
import { hoursLines, hoursProblems, relTime } from './format';
import { pageImages } from './profileApi';
import { FIELD_HINT, FIELD_LABEL, PHONE, PHOTOS, PHOTO_CATEGORY, PHOTO_STATE, PROFILE, SERVICES, SPECIAL, STATUS_LABEL } from './profileCopy';
import { PHOTO_CATEGORIES, type FieldKey, type FieldStatus, type FieldValues, type GbpPhoto, type GbpProfile, type PhotoCategory, type ProfileField, type SpecialDay } from './profileTypes';
import type { GbpProfileState } from './useGbpProfile';
import './dashboard-v3-profile.css';

// "הכרטיס שלכם בגוגל" (docs/gbp-sync-spec.md): after the business details are approved, this is where
// the owner keeps the Google listing up to date. One card per field: the value, where it stands with
// Google, and editing in place. Below: the photos on the listing.

const MAX_DESC = 750;
const MAX_SERVICES = 20;
const MAX_FILE = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const STATUS_ICON: Record<FieldStatus, ReactNode> = {
  live: <CheckCircle2 size={14} aria-hidden />,
  pending: <Clock size={14} aria-hidden />,
  google_changed: <RefreshCw size={14} aria-hidden />,
  local_only: <AlertTriangle size={14} aria-hidden />,
};

function StatusChip({ status }: { status: FieldStatus }) {
  return <span className={`dv3-p-status dv3-p-status-${status}`}>{STATUS_ICON[status]}{STATUS_LABEL[status]}</span>;
}

// ── showing a value ──────────────────────────────────────────────────────────

const dateHe = (iso: string) => { try { return new Date(`${iso}T12:00:00`).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return iso; } };

function Value<K extends FieldKey>({ k, v }: { k: K; v: FieldValues[K] | null }) {
  const empty = <p className="dv3-p-empty">{PROFILE.empty}</p>;
  if (v === null) return empty;
  switch (k) {
    case 'website': { const s = v as string; return s ? <a href={s} target="_blank" rel="noopener noreferrer" dir="ltr" className="dv3-p-link">{s}</a> : empty; }
    case 'description': { const s = v as string; return s ? <p className="dv3-p-text">{s}</p> : empty; }
    case 'phone': { const a = v as string[]; return a.length ? <ul className="dv3-p-list">{a.map((n) => <li key={n} dir="ltr">{n}</li>)}</ul> : empty; }
    case 'hours': {
      const lines = hoursLines(v as FieldValues['hours']);
      return lines.length ? <dl className="dv3-p-hours">{lines.map((l) => <div key={l.days}><dt>{l.days}</dt><dd dir="ltr">{l.spans}</dd></div>)}</dl> : empty;
    }
    case 'specialHours': {
      const a = v as SpecialDay[];
      return a.length ? <dl className="dv3-p-hours">{a.map((d) => <div key={d.date}><dt>{dateHe(d.date)}</dt><dd dir={d.closed ? undefined : 'ltr'}>{d.closed ? SPECIAL.closedText : `${d.open}–${d.close}`}</dd></div>)}</dl> : <p className="dv3-p-empty">{SPECIAL.none}</p>;
    }
    case 'services': {
      const a = v as FieldValues['services'];
      return a.length ? <ul className="dv3-p-list">{a.map((s, i) => <li key={`${s.name}-${i}`}><strong>{s.name}</strong>{s.description && <span> · {s.description}</span>}</li>)}</ul> : <p className="dv3-p-empty">{SERVICES.none}</p>;
    }
    default: return empty;
  }
}

// ── editors ──────────────────────────────────────────────────────────────────

type Editor<K extends FieldKey> = { value: FieldValues[K]; onChange: (v: FieldValues[K]) => void; label: string };

function TextEditor({ value, onChange, label, k }: Editor<'website' | 'description'> & { k: 'website' | 'description' }) {
  const id = useId();
  return k === 'website' ? (
    <input id={id} aria-label={label} className="dv3-a-input" dir="ltr" inputMode="url" placeholder="https://" maxLength={300} value={value} onChange={(e) => onChange(e.target.value)} />
  ) : (
    <>
      <textarea id={id} aria-label={label} className="dv3-a-input" rows={6} maxLength={MAX_DESC} value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="dv3-a-counter dv3-p-counter" aria-hidden>{`${value.length} / ${MAX_DESC}`}</span>
    </>
  );
}

function PhoneEditor({ value, onChange }: Editor<'phone'>) {
  const list = value.length ? value : [''];
  const set = (i: number, s: string) => onChange(list.map((x, k) => (k === i ? s : x)));
  return (
    <div className="dv3-p-rows">
      {list.map((n, i) => (
        <div key={i} className="dv3-p-row">
          <input className="dv3-a-input" dir="ltr" inputMode="tel" aria-label={i === 0 ? PHONE.main : PHONE.extra(i)} placeholder={i === 0 ? PHONE.main : PHONE.extra(i)} maxLength={20} value={n} onChange={(e) => set(i, e.target.value)} />
          {i > 0 && <button type="button" className="dv3-a-iconbtn" aria-label={PHONE.remove(n || String(i + 1))} onClick={() => onChange(list.filter((_, k) => k !== i))}><Trash2 size={18} aria-hidden /></button>}
        </div>
      ))}
      {list.length < 3 && <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" onClick={() => onChange([...list, ''])}><Plus size={16} aria-hidden /> {PHONE.add}</button>}
    </div>
  );
}

function specialProblem(list: SpecialDay[]): string | null {
  if (list.some((d) => !d.date)) return SPECIAL.errDate;
  if (new Set(list.map((d) => d.date)).size !== list.length) return SPECIAL.errDup;
  if (list.some((d) => !d.closed && (!d.open || !d.close || d.open >= d.close))) return SPECIAL.errHours;
  return null;
}

function SpecialEditor({ value, onChange }: Editor<'specialHours'>) {
  const set = (i: number, p: Partial<SpecialDay>) => onChange(value.map((d, k) => (k === i ? { ...d, ...p } : d)));
  return (
    <div className="dv3-p-rows">
      {value.length === 0 && <p className="dv3-p-empty">{SPECIAL.none}</p>}
      {value.map((d, i) => (
        <div key={i} className="dv3-p-special" role="group" aria-label={d.date ? dateHe(d.date) : `${SPECIAL.date} ${i + 1}`}>
          <label className="dv3-p-inline"><span>{SPECIAL.date}</span><input type="date" dir="ltr" className="dv3-a-input" value={d.date} onChange={(e) => set(i, { date: e.target.value })} /></label>
          <label className="dv3-p-check"><input type="checkbox" checked={d.closed} onChange={(e) => set(i, e.target.checked ? { closed: true, open: '', close: '' } : { closed: false, open: '09:00', close: '13:00' })} /><span>{SPECIAL.closed}</span></label>
          {!d.closed && (
            <div className="dv3-p-times">
              <label className="dv3-p-inline"><span>{SPECIAL.from}</span><input type="time" dir="ltr" className="dv3-a-input" value={d.open} onChange={(e) => set(i, { open: e.target.value })} /></label>
              <label className="dv3-p-inline"><span>{SPECIAL.to}</span><input type="time" dir="ltr" className="dv3-a-input" value={d.close} onChange={(e) => set(i, { close: e.target.value })} /></label>
            </div>
          )}
          <button type="button" className="dv3-a-iconbtn" aria-label={SPECIAL.remove(d.date ? dateHe(d.date) : String(i + 1))} onClick={() => onChange(value.filter((_, k) => k !== i))}><Trash2 size={18} aria-hidden /></button>
        </div>
      ))}
      <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" onClick={() => onChange([...value, { date: '', closed: true, open: '', close: '' }])}><Plus size={16} aria-hidden /> {SPECIAL.add}</button>
    </div>
  );
}

function ServicesEditor({ value, onChange }: Editor<'services'>) {
  const set = (i: number, p: Partial<FieldValues['services'][number]>) => onChange(value.map((s, k) => (k === i ? { ...s, ...p } : s)));
  return (
    <div className="dv3-p-rows">
      {value.length === 0 && <p className="dv3-p-empty">{SERVICES.none}</p>}
      {value.map((s, i) => (
        <div key={i} className="dv3-p-row dv3-p-service">
          <input className="dv3-a-input" aria-label={`${SERVICES.name} ${i + 1}`} placeholder={SERVICES.name} maxLength={140} value={s.name} onChange={(e) => set(i, { name: e.target.value })} />
          <input className="dv3-a-input" aria-label={`${SERVICES.desc}, ${s.name || i + 1}`} placeholder={SERVICES.desc} maxLength={250} value={s.description} onChange={(e) => set(i, { description: e.target.value })} />
          <button type="button" className="dv3-a-iconbtn" aria-label={SERVICES.remove(s.name || String(i + 1))} onClick={() => onChange(value.filter((_, k) => k !== i))}><Trash2 size={18} aria-hidden /></button>
        </div>
      ))}
      {value.length < MAX_SERVICES && <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" onClick={() => onChange([...value, { name: '', description: '' }])}><Plus size={16} aria-hidden /> {SERVICES.add}</button>}
    </div>
  );
}

/** The value as it goes to the server: trimmed, empty rows dropped. Returns a sentence when it cannot go. */
function prepare<K extends FieldKey>(k: K, v: FieldValues[K]): { value: FieldValues[K]; problem: string | null } {
  switch (k) {
    case 'website': { const s = (v as string).trim(); return { value: s as FieldValues[K], problem: s && !/^https:\/\/[^\s]+\.[^\s]+/.test(s) ? FIELD_HINT.website : null }; }
    case 'description': return { value: (v as string).trim() as FieldValues[K], problem: null };
    case 'phone': return { value: (v as string[]).map((x) => x.trim()).filter(Boolean) as FieldValues[K], problem: null };
    case 'hours': return { value: v, problem: Object.keys(hoursProblems(v as FieldValues['hours'])).length ? FIELD_HINT.hours : null };
    case 'specialHours': return { value: v, problem: specialProblem(v as SpecialDay[]) };
    case 'services': { const a = (v as FieldValues['services']).map((s) => ({ name: s.name.trim(), description: s.description.trim() })).filter((s) => s.name); return { value: a as FieldValues[K], problem: null }; }
    default: return { value: v, problem: null };
  }
}

const EMPTY: FieldValues = { website: '', description: '', phone: [], hours: [], specialHours: [], services: [] };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ── one field ────────────────────────────────────────────────────────────────

function FieldCard<K extends FieldKey>({ k, f, state }: { k: K; f: ProfileField<K>; state: GbpProfileState }) {
  const headId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FieldValues[K]>(clone(f.ours ?? EMPTY[k]));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'error' | 'info'; text: string; detail?: string } | null>(null);
  const [hoursTried, setHoursTried] = useState(false);

  const open = () => { setDraft(clone(f.ours ?? EMPTY[k])); setNote(null); setHoursTried(false); setEditing(true); };
  const submit = async () => {
    const { value, problem } = prepare(k, draft);
    if (k === 'hours') setHoursTried(true);
    if (problem) { setNote({ kind: 'error', text: problem }); return; }
    setBusy(true); setNote(null);
    const r = await state.save(k, value);
    setBusy(false);
    if (!r.ok) { setNote({ kind: 'error', text: r.message, detail: r.detail }); return; }
    setEditing(false);
    setNote(r.localOnly ? { kind: 'info', text: r.message ?? PROFILE.savedLocal } : { kind: 'ok', text: `${PROFILE.saved} ${PROFILE.googleDelay}` });
  };
  const resolve = async (keep: 'google' | 'ours') => {
    setBusy(true); setNote(null);
    const r = await state.resolve(k, keep);
    setBusy(false);
    setNote(r.ok ? { kind: 'ok', text: keep === 'ours' ? `${PROFILE.saved} ${PROFILE.googleDelay}` : PROFILE.kept } : { kind: 'error', text: r.message, detail: r.detail });
  };

  let editor: ReactNode = null;
  if (editing) {
    const label = FIELD_LABEL[k];
    const on = (v: FieldValues[K]) => setDraft(v);
    if (k === 'website' || k === 'description') editor = <TextEditor k={k} label={label} value={draft as string} onChange={on as (v: string) => void} />;
    else if (k === 'phone') editor = <PhoneEditor label={label} value={draft as string[]} onChange={on as (v: string[]) => void} />;
    else if (k === 'hours') editor = <HoursField value={draft as FieldValues['hours']} onChange={on as (v: FieldValues['hours']) => void} problems={hoursTried ? hoursProblems(draft as FieldValues['hours']) : {}} />;
    else if (k === 'specialHours') editor = <SpecialEditor label={label} value={draft as SpecialDay[]} onChange={on as (v: SpecialDay[]) => void} />;
    else editor = <ServicesEditor label={label} value={draft as FieldValues['services']} onChange={on as (v: FieldValues['services']) => void} />;
  }

  return (
    <section className="dv4-card dv3-p-field" aria-labelledby={headId} data-status={f.status}>
      <div className="dv4-card-head">
        <h3 id={headId}>{FIELD_LABEL[k]}</h3>
        <StatusChip status={f.status} />
      </div>
      <p className="dv3-a-hint">{FIELD_HINT[k]}</p>

      {f.status === 'google_changed' && !editing ? (
        <div className="dv3-p-changed" role="group" aria-label={PROFILE.changedTitle}>
          <p className="dv3-p-changed-title"><strong>{PROFILE.changedTitle}</strong> {PROFILE.changedBody}</p>
          <div className="dv3-p-compare">
            <div><h4>{PROFILE.oursLabel}</h4><Value k={k} v={f.ours} /></div>
            <div><h4>{PROFILE.googleLabel}</h4><Value k={k} v={f.google} /></div>
          </div>
          <div className="dv3-p-actions">
            <button type="button" className="dv3-btn dv3-a-small" disabled={busy} onClick={() => void resolve('google')}>{PROFILE.keepGoogle}</button>
            <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" disabled={busy} onClick={() => void resolve('ours')}>{PROFILE.keepOurs}</button>
          </div>
        </div>
      ) : editing ? (
        <div className="dv3-p-edit">{editor}</div>
      ) : (
        <div className="dv3-p-value"><Value k={k} v={f.ours} /></div>
      )}

      {f.status === 'local_only' && f.error && !note && <Notice kind="error">{f.error}</Notice>}
      <div aria-live="polite" className="dv3-a-live">
        {busy && <p className="dv3-a-hint">{PROFILE.saving}</p>}
        {!busy && note && <Notice kind={note.kind}>{note.text}{note.detail && <bdi dir="auto" className="dv3-p-detail">{note.detail}</bdi>}</Notice>}
      </div>

      <div className="dv3-p-actions">
        {editing ? (
          <>
            <button type="button" className="dv3-btn dv3-a-small" disabled={busy} onClick={() => void submit()}>{busy ? PROFILE.saving : PROFILE.save}</button>
            <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" disabled={busy} onClick={() => { setEditing(false); setNote(null); }}>{PROFILE.cancel}</button>
          </>
        ) : f.status !== 'google_changed' && (
          <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" onClick={open} aria-label={`${PROFILE.edit}: ${FIELD_LABEL[k]}`}><Pencil size={16} aria-hidden /> {PROFILE.edit}</button>
        )}
      </div>
    </section>
  );
}

// ── photos ───────────────────────────────────────────────────────────────────

const catLabel = (c: string) => PHOTO_CATEGORY[c as PhotoCategory] ?? PHOTO_CATEGORY.ADDITIONAL;

function imageSize(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
      img.src = url;
    } catch { resolve(null); }
  });
}

function PhotoTile({ p, onRemove, canEdit }: { p: GbpPhoto; onRemove: (id: string) => Promise<string | null>; canEdit: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const state = PHOTO_STATE[p.state];
  return (
    <li className="dv3-p-photo" data-state={p.state}>
      <img src={p.thumbUrl} alt={PHOTOS.photoAlt(catLabel(p.category))} loading="lazy" />
      <div className="dv3-p-photo-meta">
        <span className="dv3-p-photo-cat">{catLabel(p.category)}</span>
        {state && <span className={`dv3-p-photo-state dv3-p-photo-${p.state}`}><Clock size={12} aria-hidden />{state}</span>}
      </div>
      {canEdit && (confirm ? (
        <div className="dv3-p-photo-confirm" role="alertdialog" aria-label={PHOTOS.removeConfirm}>
          <p>{PHOTOS.removeConfirm}</p>
          <div>
            <button type="button" className="dv3-btn dv3-a-small dv3-p-danger" disabled={busy} onClick={async () => { setBusy(true); const e = await onRemove(p.id); setBusy(false); if (e) { setErr(e); setConfirm(false); } }}>{PHOTOS.removeYes}</button>
            <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" disabled={busy} onClick={() => setConfirm(false)}>{PHOTOS.removeNo}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="dv3-p-photo-remove" aria-label={`${PHOTOS.remove}: ${catLabel(p.category)}`} onClick={() => { setErr(null); setConfirm(true); }}><Trash2 size={16} aria-hidden /></button>
      ))}
      {err && <p className="dv3-p-photo-err" role="alert">{err}</p>}
    </li>
  );
}

const MAX_BATCH = 10;   // Google allows 10 edits a minute per listing; the photos go up one after another

function AddPhoto({ state, pageSlug, onDone }: { state: GbpProfileState; pageSlug: string | null; onDone: (text: string, kind: 'ok' | 'error') => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const catId = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [cat, setCat] = useState<PhotoCategory>('COVER');
  const [progress, setProgress] = useState<number | null>(null);
  const [batch, setBatch] = useState<{ at: number; of: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fromPage, setFromPage] = useState<string[] | null>(null);
  const [pageOpen, setPageOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [pageBusy, setPageBusy] = useState(false);
  const busy = progress !== null || pageBusy;

  // The page's images are looked up once; the option shows only when there are some.
  useEffect(() => {
    if (!pageSlug) return;
    let alive = true;
    void pageImages(pageSlug).then((u) => alive && setFromPage(u));
    return () => { alive = false; };
  }, [pageSlug]);

  /** Several files at once: each is checked; the good ones are kept, and the user is told about the rest. */
  const pick = async (list: FileList | null) => {
    setErr(null); setFiles([]);
    const all = Array.from(list ?? []);
    if (!all.length) return;
    const ok: File[] = [];
    let wrongType = 0, tooBig = 0, tooSmall = 0;
    for (const f of all) {
      if (!TYPES.includes(f.type)) { wrongType++; continue; }
      if (f.size > MAX_FILE) { tooBig++; continue; }
      const size = await imageSize(f);
      if (size && Math.min(size.w, size.h) < 250) { tooSmall++; continue; }
      ok.push(f);
    }
    const kept = ok.slice(0, MAX_BATCH);
    const problems: string[] = [];
    if (wrongType) problems.push(PHOTOS.skippedType(wrongType));
    if (tooBig) problems.push(PHOTOS.skippedBig(tooBig));
    if (tooSmall) problems.push(PHOTOS.skippedSmall(tooSmall));
    if (ok.length > MAX_BATCH) problems.push(PHOTOS.skippedMany(MAX_BATCH));
    if (problems.length) setErr(problems.join(' '));
    setFiles(kept);
  };

  /** Sends one after another; stops at the first failure and says how many already went up. */
  const sendAll = async (jobs: Array<(onProgress: (p: number) => void) => Promise<{ error: string } | { small: boolean }>>) => {
    let sent = 0, small = 0;
    for (let i = 0; i < jobs.length; i++) {
      setBatch({ at: i + 1, of: jobs.length }); setProgress(0);
      const r = await jobs[i]((p) => setProgress(Math.round(p * 100)));
      if ('error' in r) { setProgress(null); setBatch(null); setErr(sent ? `${PHOTOS.partial(sent, jobs.length)} ${r.error}` : r.error); if (sent) onDone(PHOTOS.addedMany(sent), 'ok'); return sent; }
      sent++; if (r.small) small++;
    }
    setProgress(null); setBatch(null);
    const base = sent === 1 ? PHOTOS.added : PHOTOS.addedMany(sent);
    onDone(small ? `${base} ${sent === 1 ? PHOTOS.small : PHOTOS.smallMany(small)}` : base, 'ok');
    return sent;
  };

  const send = async () => {
    if (!files.length) return;
    setErr(null);
    const sent = await sendAll(files.map((f) => (onProgress: (p: number) => void) => state.upload(f, cat, onProgress)));
    if (sent === files.length) { setFiles([]); if (fileRef.current) fileRef.current.value = ''; }
    else { setFiles(files.slice(sent)); }
  };
  const sendFromPage = async () => {
    if (!picked.length) return;
    setPageBusy(true); setErr(null);
    const sent = await sendAll(picked.map((u) => () => state.addFromPage(u, cat)));
    setPageBusy(false);
    if (sent === picked.length) { setPicked([]); setPageOpen(false); } else setPicked(picked.slice(sent));
  };
  const toggle = (u: string) => setPicked((l) => (l.includes(u) ? l.filter((x) => x !== u) : l.length >= MAX_BATCH ? l : [...l, u]));

  return (
    <div className="dv3-p-add">
      <div className="dv3-p-add-row">
        <label htmlFor={catId} className="dv3-p-inline"><span>{PHOTOS.category}</span>
          <select id={catId} className="dv3-a-input" value={cat} onChange={(e) => setCat(e.target.value as PhotoCategory)}>
            {PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{PHOTO_CATEGORY[c]}</option>)}
          </select>
        </label>
        <input ref={fileRef} type="file" multiple accept={TYPES.join(',')} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void pick(e.target.files)} />
        <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" disabled={busy} onClick={() => fileRef.current?.click()}>
          <ImagePlus size={16} aria-hidden /> {files.length === 1 ? <bdi dir="ltr">{files[0].name}</bdi> : files.length > 1 ? PHOTOS.chosen(files.length) : PHOTOS.pick}
        </button>
        {fromPage && fromPage.length > 0 && (
          <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" aria-expanded={pageOpen} disabled={busy} onClick={() => setPageOpen((o) => !o)}><Images size={16} aria-hidden /> {PHOTOS.fromPage}</button>
        )}
      </div>
      {files.length > 0 && (
        <button type="button" className="dv3-btn dv3-a-small dv3-p-upload" disabled={busy} onClick={() => void send()}>
          {progress !== null ? PHOTOS.uploadingBatch(batch, progress) : PHOTOS.uploadMany(files.length)}
        </button>
      )}
      {progress !== null && <div className="dv3-p-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>}
      {pageOpen && fromPage && (
        <div className="dv3-p-frompage">
          <div className="dv3-p-frompage-head"><strong>{PHOTOS.fromPageTitle}</strong><button type="button" className="dv3-a-iconbtn" aria-label={PROFILE.cancel} onClick={() => setPageOpen(false)}><X size={18} aria-hidden /></button></div>
          <ul>
            {fromPage.map((u, i) => (
              <li key={u}>
                <button type="button" disabled={pageBusy} aria-pressed={picked.includes(u)} onClick={() => toggle(u)} aria-label={`${PHOTOS.pickOne} ${i + 1}`} style={picked.includes(u) ? { outline: '3px solid var(--dv3-accent, #2563eb)', outlineOffset: -3 } : undefined}>
                  <img src={u} alt="" loading="lazy" />
                  {picked.includes(u) && <span className="dv3-p-frompage-busy">✓</span>}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="dv3-btn dv3-a-small dv3-p-upload" disabled={pageBusy || !picked.length} onClick={() => void sendFromPage()}>
            {pageBusy ? PHOTOS.uploadingBatch(batch, progress ?? 0) : PHOTOS.uploadMany(picked.length)}
          </button>
        </div>
      )}
      {err && <Notice kind="error">{err}</Notice>}
    </div>
  );
}

function PhotosSection({ state, syncEnabled, pageSlug }: { state: GbpProfileState; syncEnabled: boolean; pageSlug: string | null }) {
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const { photos } = state;
  const remove = async (id: string) => { const e = await state.removePhoto(id); setNote(e ? { kind: 'error', text: e } : { kind: 'ok', text: PHOTOS.removed }); return e; };
  return (
    <section className="dv4-card dv3-p-photos" aria-labelledby="dv3-p-photos">
      <div className="dv4-card-head"><h3 id="dv3-p-photos">{PHOTOS.title}</h3></div>
      <p className="dv3-a-hint">{PHOTOS.hint}</p>
      {photos.status === 'loading' && <div className="dv3-p-grid" aria-busy="true" aria-label="טוען">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 !rounded-[14px]" />)}</div>}
      {photos.status === 'error' && <LoadError text={PHOTOS.loadError} onRetry={state.reload} />}
      {photos.status === 'ok' && (photos.data.length === 0
        ? <p className="dv3-p-empty">{PHOTOS.empty}</p>
        : <ul className="dv3-p-grid">{photos.data.map((p) => <PhotoTile key={p.id} p={p} onRemove={remove} canEdit={syncEnabled} />)}</ul>)}
      {syncEnabled ? <AddPhoto state={state} pageSlug={pageSlug} onDone={(text, kind) => setNote({ kind, text })} /> : <Notice kind="info">{PHOTOS.syncOff}</Notice>}
      <div aria-live="polite" className="dv3-a-live">{note && <Notice kind={note.kind}>{note.text}</Notice>}</div>
    </section>
  );
}

// ── the screen ───────────────────────────────────────────────────────────────

const ORDER: FieldKey[] = ['website', 'phone', 'hours', 'specialHours', 'description', 'services'];

export function GoogleProfileBody({ state, pageSlug, onMore }: { state: GbpProfileState; pageSlug: string | null; onMore: () => void }) {
  const { profile } = state;
  if (profile.status === 'loading') return <div className="flex flex-col gap-4" aria-busy="true" aria-label="טוען"><Skeleton className="h-24 !rounded-[24px]" /><Skeleton className="h-40 !rounded-[24px]" /><Skeleton className="h-56 !rounded-[24px]" /></div>;
  if (profile.status === 'error') return <LoadError text={`${PROFILE.loadError} ${profile.error}`} onRetry={state.reload} />;
  const p: GbpProfile = profile.data;
  return (
    <div className="dv3-p">
      {!p.syncEnabled && <div className="dv3-a-msg dv3-a-msg-info dv3-p-banner" role="note"><AlertTriangle size={18} aria-hidden /><p>{PROFILE.syncOff}</p></div>}
      <div className="dv3-p-top">
        <p className="dv3-a-hint">{p.checkedAt ? PROFILE.checked(relTime(p.checkedAt)) : PROFILE.googleDelay}</p>
        {p.metadata.mapsUri && <a className="dv3-linkbtn dv3-p-maps" href={p.metadata.mapsUri} target="_blank" rel="noopener noreferrer">{PROFILE.openMaps} <ExternalLink size={14} aria-hidden /></a>}
      </div>
      {ORDER.map((k) => {
        const f = p.fields[k];
        return f ? <FieldCard key={k} k={k} f={f as ProfileField<typeof k>} state={state} /> : null;
      })}
      <PhotosSection state={state} syncEnabled={p.syncEnabled} pageSlug={pageSlug} />
      <button type="button" className="dv4-card dv3-p-more" onClick={onMore}>
        <strong>{PROFILE.moreDetails}</strong>
        <small>{PROFILE.moreDetailsSub}</small>
      </button>
    </div>
  );
}

export default function GoogleProfile({ state, preview, pageSlug, onMore }: { state: GbpProfileState; preview: boolean; pageSlug: string | null; onMore: () => void }) {
  return (
    <ViewShell title={PROFILE.title} hint={PROFILE.hint}>
      {preview && <SampleBanner />}
      <GoogleProfileBody state={state} pageSlug={pageSlug} onMore={onMore} />
    </ViewShell>
  );
}

