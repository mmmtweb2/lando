import type { ReactNode } from 'react';

/** Who does it: "we" = the product (soft blue), "you" = the customer (white, thin outline). */
export function Who({ who }: { who: 'we' | 'you' }) {
  return who === 'we'
    ? <span className="rounded-full bg-[var(--tint)] px-2 text-[11px] font-semibold leading-5 text-[var(--accent-strong)]">אנחנו</span>
    : <span className="rounded-full border border-[var(--line)] bg-white px-2 text-[11px] font-semibold leading-5 text-[var(--muted)]">אתם</span>;
}

export function SoonChip() {
  return <span className="rounded-full border border-[var(--line)] px-2 text-[11px] font-semibold leading-5 text-[var(--muted)]">בקרוב</span>;
}

/** Row of blocks, one per setup step. Filled blocks are the finished steps. */
export function Segments({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label} className="flex gap-1.5" dir="rtl">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-2.5 flex-1 rounded-full ${i < done ? 'bg-[var(--accent)]' : 'bg-[#C9D6F6]'}`} />
      ))}
    </div>
  );
}

/** Section header: a plain title with an optional one-line hint. */
export function SectionTitle({ id, title, hint }: { id?: string; title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="text-lg font-bold leading-tight text-[var(--ink)]">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`dv2-skeleton ${className}`} />;
}

export function Check({ done, children }: { done: boolean; children?: ReactNode }) {
  return <span className="dv2-check" data-done={done} aria-hidden>{done ? children : null}</span>;
}
