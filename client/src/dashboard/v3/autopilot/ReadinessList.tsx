import { AlertTriangle, Check, Minus } from 'lucide-react';
import { CARD } from '../autopilotCopy';
import type { CheckState, Readiness } from './types';

const ICON: Record<CheckState, typeof Check> = { ok: Check, weak: Minus, missing: AlertTriangle };

/** What is filled in the business card, what is thin and what is missing, as the server judged it. */
export default function ReadinessList({ readiness }: { readiness: Readiness }) {
  const { checks, done, total } = readiness;
  const count = CARD.readinessCount(done, total);
  return (
    <div className="dv3-a-ready">
      <div className="dv3-a-ready-head">
        <h4>{CARD.readinessTitle}</h4>
        <strong>{count}</strong>
      </div>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={count} className="dv3-segs" dir="rtl">
        {Array.from({ length: total }, (_, i) => <span key={i} data-on={i < done} />)}
      </div>
      <ul className="dv3-a-checks">
        {checks.map((c) => {
          const Icon = ICON[c.state] ?? Minus;
          return (
            <li key={c.key} data-state={c.state}>
              <span className="dv3-a-check-mark" aria-hidden><Icon size={15} strokeWidth={3} /></span>
              <div>
                <p className="dv3-a-check-title">
                  <span>{c.title}</span>
                  <span className="dv3-a-check-state">{CARD.state[c.state] ?? ''}</span>
                  {c.required && <span className="dv3-a-check-req">{CARD.required}</span>}
                </p>
                <p className="dv3-a-check-why">{c.why}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
