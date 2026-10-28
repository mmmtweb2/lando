import type { ReactNode } from 'react';
import type { StepState } from './journey';

export function StateChip({ state, children }: { state: StepState; children: ReactNode }) {
  const cls: Record<StepState, string> = {
    done: 'bg-[var(--dv2-ok-bg)] text-[var(--dv2-ok-ink)]',
    yours: 'bg-[var(--dv2-tint)] text-[var(--dv2-accent-strong)]',
    ours: 'bg-[var(--dv2-tint)] text-[var(--dv2-ink)]',
    waiting: 'bg-slate-100 text-[var(--dv2-muted)]',
  };
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${cls[state]}`}>{children}</span>;
}

export function SoonChip() {
  return <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-[var(--dv2-muted)]">בקרוב</span>;
}

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}
      className="h-2 w-full overflow-hidden rounded-full bg-[var(--dv2-tint)]">
      <div className="h-full rounded-full bg-[var(--dv2-accent)] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function SectionTitle({ id, title, hint }: { id?: string; title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="text-lg font-bold text-[var(--dv2-ink)]">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-[var(--dv2-muted)]">{hint}</p>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`dv2-skeleton ${className}`} />;
}

/** Who does it: "we" = the product (soft blue), "you" = the customer (navy outline). Same meaning as RoleTag, v2 colors. */
export function Who({ who }: { who: 'we' | 'you' }) {
  return who === 'we'
    ? <span className="rounded-md bg-[var(--dv2-tint)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--dv2-accent-strong)]">אנחנו</span>
    : <span className="rounded-md border border-[var(--dv2-ink)]/30 px-1.5 py-0.5 text-[11px] font-bold text-[var(--dv2-ink)]">אתם</span>;
}
