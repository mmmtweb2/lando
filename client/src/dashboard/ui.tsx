import type { ReactNode } from 'react';

/** Who does it: "we" = the product (soft blue), "you" = the customer (white with navy outline). */
export function Who({ who }: { who: 'we' | 'you' }) {
  return who === 'we'
    ? <span className="rounded-md border-2 border-[var(--accent-strong)] bg-[var(--tint)] px-1.5 text-[11px] font-extrabold leading-5 text-[var(--accent-strong)]">אנחנו</span>
    : <span className="rounded-md border-2 border-[var(--ink)] bg-white px-1.5 text-[11px] font-extrabold leading-5 text-[var(--ink)]">אתם</span>;
}

export function SoonChip() {
  return <span className="rounded-md border-2 border-dashed border-[var(--muted)] px-1.5 text-[11px] font-extrabold leading-5 text-[var(--muted)]">בקרוב</span>;
}

/** Row of blocks, one per setup step. Filled blocks are the finished steps. */
export function Segments({ done, total, label }: { done: number; total: number; label: string }) {
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={label} className="flex gap-1.5" dir="rtl">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-4 flex-1 rounded-[5px] border-2 border-[var(--ink)] ${i < done ? 'bg-[var(--ok)]' : 'bg-white'}`} />
      ))}
    </div>
  );
}

/** Section header: a small numbered square, then a heavy title with a highlighter on the marked words. */
export function SectionTitle({ id, no, title, mark, hint }: { id?: string; no?: string; title: string; mark?: string; hint?: string }) {
  const parts = mark && title.includes(mark) ? title.split(mark) : null;
  return (
    <div className="mb-3 flex items-start gap-3">
      {no && <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[var(--ink)] text-sm font-extrabold tabular-nums text-white" aria-hidden>{no}</span>}
      <div>
        <h2 id={id} className="text-xl font-extrabold leading-tight text-[var(--ink)]">
          {parts ? <>{parts[0]}<span className="dv2-mark">{mark}</span>{parts[1]}</> : title}
        </h2>
        {hint && <p className="mt-0.5 text-sm text-[var(--muted)]">{hint}</p>}
      </div>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`dv2-skeleton ${className}`} />;
}

export function Check({ done, children }: { done: boolean; children?: ReactNode }) {
  return <span className="dv2-check" data-done={done} aria-hidden>{done ? children : null}</span>;
}
