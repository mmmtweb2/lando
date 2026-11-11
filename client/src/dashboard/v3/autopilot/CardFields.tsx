import { useId, useState, type ReactNode } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { CARD } from '../autopilotCopy';
import type { CardForm } from './format';

// The editable fields of the business card. Controlled: the screen owns the values.

export const MAX_SERVICES = 20;
export const MAX_AREAS = 10;
export const MAX_DESCRIPTION = 750;
export const MAX_NOTES = 1000;

export function Field({ label, hint, counter, children }: { label: string; hint?: string; counter?: string; children: (ids: { id: string; describedBy?: string }) => ReactNode }) {
  const id = useId();
  const hintId = hint ? `${id}-h` : undefined;
  return (
    <div className="dv3-a-field">
      <div className="dv3-a-field-head">
        <label htmlFor={id}>{label}</label>
        {counter && <span className="dv3-a-counter" aria-hidden>{counter}</span>}
      </div>
      {hint && <p id={hintId} className="dv3-a-hint">{hint}</p>}
      {children({ id, describedBy: hintId })}
    </div>
  );
}

export function TextArea({ label, hint, value, max, rows, onChange }: { label: string; hint: string; value: string; max: number; rows: number; onChange: (v: string) => void }) {
  return (
    <Field label={label} hint={hint} counter={`${value.length} / ${max}`}>
      {({ id, describedBy }) => (
        <textarea id={id} aria-describedby={describedBy} className="dv3-a-input" rows={rows} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

export function ServicesField({ value, onChange }: { value: CardForm['services']; onChange: (v: CardForm['services']) => void }) {
  const set = (i: number, patch: Partial<CardForm['services'][number]>) => onChange(value.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  return (
    <fieldset className="dv3-a-field">
      <div className="dv3-a-field-head">
        <legend>{CARD.services}</legend>
        <span className="dv3-a-counter" aria-hidden>{`${value.length} / ${MAX_SERVICES}`}</span>
      </div>
      <p className="dv3-a-hint">{CARD.servicesHint}</p>
      {value.length === 0 && <p className="dv3-a-empty">{CARD.noServices}</p>}
      <ul className="dv3-a-services">
        {value.map((s, i) => (
          <li key={i}>
            <input className="dv3-a-input" aria-label={`${CARD.serviceName} ${i + 1}`} placeholder={CARD.serviceName} maxLength={60} value={s.name} onChange={(e) => set(i, { name: e.target.value })} />
            <input className="dv3-a-input" aria-label={`${CARD.serviceDesc}, ${s.name || i + 1}`} placeholder={CARD.serviceDesc} maxLength={300} value={s.description} onChange={(e) => set(i, { description: e.target.value })} />
            <button type="button" className="dv3-a-iconbtn" aria-label={`${CARD.removeService} ${s.name || i + 1}`} onClick={() => onChange(value.filter((_, k) => k !== i))}><Trash2 size={18} aria-hidden /></button>
          </li>
        ))}
      </ul>
      <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" disabled={value.length >= MAX_SERVICES} onClick={() => onChange([...value, { name: '', description: '' }])}>
        <Plus size={16} aria-hidden /> {CARD.addService}
      </button>
    </fieldset>
  );
}

export function AreasField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const id = useId();
  const full = value.length >= MAX_AREAS;
  const add = () => {
    const a = draft.trim();
    if (!a || full) return;
    if (!value.some((x) => x.toLowerCase() === a.toLowerCase())) onChange([...value, a]);
    setDraft('');
  };
  return (
    <div className="dv3-a-field">
      <div className="dv3-a-field-head">
        <label htmlFor={id}>{CARD.areas}</label>
        <span className="dv3-a-counter" aria-hidden>{`${value.length} / ${MAX_AREAS}`}</span>
      </div>
      <p id={`${id}-h`} className="dv3-a-hint">{CARD.areasHint}</p>
      {value.length === 0 ? <p className="dv3-a-empty">{CARD.noAreas}</p> : (
        <ul className="dv3-a-chips">
          {value.map((a) => (
            <li key={a}>
              <span>{a}</span>
              <button type="button" aria-label={`${CARD.removeArea} ${a}`} onClick={() => onChange(value.filter((x) => x !== a))}><X size={16} aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="dv3-a-addrow">
        <input
          id={id} aria-describedby={`${id}-h`} className="dv3-a-input" placeholder={CARD.areaNew} maxLength={60} disabled={full} value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button type="button" className="dv3-btn dv3-btn-ghost" disabled={full || !draft.trim()} onClick={add}>{CARD.addArea}</button>
      </div>
    </div>
  );
}
