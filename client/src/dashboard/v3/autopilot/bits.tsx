import type { ReactNode } from 'react';
import { AlertCircle, Check, Info } from 'lucide-react';
import { RETRY, SAMPLE_NOTE } from '../autopilotCopy';

/** A fetch that failed: the sentence and a way to try again. Never blocks the rest of the screen. */
export function LoadError({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="dv3-a-msg dv3-a-msg-error" role="alert">
      <AlertCircle size={18} aria-hidden />
      <p>{text}</p>
      {onRetry && <button type="button" className="dv3-btn dv3-btn-ghost dv3-a-small" onClick={onRetry}>{RETRY}</button>}
    </div>
  );
}

/** A short message after an action. `ok` is announced politely, `error` right away. */
export function Notice({ kind, children }: { kind: 'ok' | 'error' | 'info'; children: ReactNode }) {
  const Icon = kind === 'ok' ? Check : kind === 'error' ? AlertCircle : Info;
  return (
    <div className={`dv3-a-msg dv3-a-msg-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden />
      <p>{children}</p>
    </div>
  );
}

export function SampleBanner() {
  return <p className="dv3-a-sample" role="note">{SAMPLE_NOTE}</p>;
}
