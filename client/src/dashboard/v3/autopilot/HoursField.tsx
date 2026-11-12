import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { CARD } from '../autopilotCopy';
import { DAYS, DAY_HE, type HoursProblem } from './format';
import type { Day, TruthHours } from './types';

// The opening hours, editable: seven day rows, each closed or with one range, and a second range for
// a day with a break in the middle. Controlled: the screen owns the list (the shape PUT /api/seo/truth
// takes: a closed day simply has no entries). Native time inputs, so every phone shows its own picker.

const MAX_RANGES = 2;
const NEW_RANGE = { open: '09:00', close: '17:00' };
const PROBLEM: Record<HoursProblem, string> = { missing: CARD.hoursErrMissing, order: CARD.hoursErrOrder, overlap: CARD.hoursErrOverlap };

interface Props {
  value: TruthHours[];
  onChange: (v: TruthHours[]) => void;
  /** what is wrong, by day; shown under that day's row */
  problems: Partial<Record<Day, HoursProblem>>;
}

export default function HoursField({ value, onChange, problems }: Props) {
  const id = useId();
  const setDay = (day: Day, ranges: { open: string; close: string }[]) =>
    onChange(DAYS.flatMap((d) => (d === day ? ranges.map((r) => ({ day, ...r })) : value.filter((h) => h.day === d))));

  return (
    <fieldset className="dv3-a-field dv4-hours">
      <div className="dv3-a-field-head"><legend>{CARD.hours}</legend></div>
      <p className="dv3-a-hint">{CARD.hoursHint}</p>
      <ul className="dv4-hours-list">
        {DAYS.map((day) => {
          const name = DAY_HE[day];
          const ranges = value.filter((h) => h.day === day).map(({ open, close }) => ({ open, close }));
          const closed = ranges.length === 0;
          const problem = problems[day];
          const errId = `${id}-${day}-e`;
          const edit = (i: number, patch: Partial<{ open: string; close: string }>) => setDay(day, ranges.map((r, k) => (k === i ? { ...r, ...patch } : r)));
          return (
            <li key={day} data-closed={closed || undefined} data-bad={problem ? true : undefined}>
              <span className="dv4-hours-day">{name}</span>
              <label className="dv4-hours-closed">
                <input type="checkbox" checked={closed} aria-label={`${CARD.hoursDay(name)}: ${CARD.hoursClosed}`} onChange={(e) => setDay(day, e.target.checked ? [] : [NEW_RANGE])} />
                <span>{CARD.hoursClosed}</span>
              </label>
              {!closed && (
                <div className="dv4-hours-ranges">
                  {ranges.map((r, i) => (
                    <div key={i} className="dv4-hours-range" role="group" aria-label={`${CARD.hoursDay(name)}, ${CARD.hoursRange(i)}`}>
                      <label>
                        <span>{CARD.hoursFrom}</span>
                        <input type="time" dir="ltr" className="dv3-a-input" value={r.open} aria-invalid={problem ? true : undefined} aria-describedby={problem ? errId : undefined} onChange={(e) => edit(i, { open: e.target.value })} />
                      </label>
                      <label>
                        <span>{CARD.hoursTo}</span>
                        <input type="time" dir="ltr" className="dv3-a-input" value={r.close} aria-invalid={problem ? true : undefined} aria-describedby={problem ? errId : undefined} onChange={(e) => edit(i, { close: e.target.value })} />
                      </label>
                      {i > 0 && (
                        <button type="button" className="dv4-hours-remove" aria-label={CARD.hoursRemoveLabel(name)} title={CARD.hoursRemove} onClick={() => setDay(day, ranges.filter((_, k) => k !== i))}>
                          <Trash2 size={18} aria-hidden /><span aria-hidden>{CARD.hoursRemove}</span>
                        </button>
                      )}
                    </div>
                  ))}
                  {ranges.length < MAX_RANGES && (
                    <button type="button" className="dv4-hours-add" aria-label={CARD.hoursAddLabel(name)} onClick={() => setDay(day, [...ranges, { open: '', close: '' }])}>
                      <Plus size={16} aria-hidden /> {CARD.hoursAdd}
                    </button>
                  )}
                </div>
              )}
              {problem && <p id={errId} className="dv4-hours-err" role="alert">{PROBLEM[problem]}</p>}
            </li>
          );
        })}
      </ul>
      <p className="dv3-a-hint">{CARD.hoursNote}</p>
    </fieldset>
  );
}
