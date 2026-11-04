import { useEffect, useId, useState } from 'react';
import { ChevronDown, ExternalLink } from 'lucide-react';
import {
  SEEN_KEY, WHAT_PROMOTES_CLOSING, WHAT_PROMOTES_INTRO, WHAT_PROMOTES_POINTS, WHAT_PROMOTES_SOURCE, WHAT_PROMOTES_TITLE, initialOpen,
} from './whatPromotes';

function readSeen(email: string): string | null {
  try { return window.localStorage.getItem(SEEN_KEY + email); } catch { return null; }
}

// Open/closed state for this page load, per account. The block can unmount and come back while the
// customer stays on the page (the guided setup swaps screens, the dashboard switches views); it must
// keep what it showed instead of re-reading "seen" and collapsing before anyone could read it.
const live = new Map<string, boolean>();
function startOpen(email: string): boolean {
  const known = live.get(email);
  if (known !== undefined) return known;
  const o = initialOpen(readSeen(email));
  live.set(email, o);
  return o;
}

/**
 * Small collapsible explainer for the dashboard home. Open on the account's first visit, collapsed
 * afterwards; the customer can open or close it at any time. Plain words, no promise of a result.
 */
export default function WhatPromotes({ email }: { email: string }) {
  const [open, setOpen] = useState<boolean>(() => startOpen(email));
  const id = useId();
  const bodyId = `${id}-body`;

  // Remember that it was shown. Shown once is enough, so later screens start collapsed.
  useEffect(() => {
    try { window.localStorage.setItem(SEEN_KEY + email, '1'); } catch { /* not remembered: it simply opens again */ }
  }, [email]);

  return (
    <section className="dv2-card-flat border-[var(--accent-strong)]/30 bg-[var(--tint)]" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="m-0 text-[16px] font-bold text-[var(--ink)]">
        <button
          type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => { live.set(email, !open); setOpen(!open); }}
          className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-[14px] px-4 py-2 text-right"
        >
          <span>{WHAT_PROMOTES_TITLE}</span>
          <ChevronDown size={20} aria-hidden className={`flex-shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`} />
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className="px-4 pb-4">
        <p className="text-[15px] leading-relaxed text-[var(--ink)]">{WHAT_PROMOTES_INTRO}</p>
        <div className="mt-2 flex flex-col gap-2">
          {WHAT_PROMOTES_POINTS.map((p) => (
            <p key={p.label} className="text-[15px] leading-relaxed text-[var(--ink)]"><strong className="font-bold">{p.label}:</strong> {p.text}</p>
          ))}
          <p className="text-[15px] leading-relaxed text-[var(--ink)]">{WHAT_PROMOTES_CLOSING}</p>
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">
          <a
            href={WHAT_PROMOTES_SOURCE.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1 underline underline-offset-4"
          >
            {WHAT_PROMOTES_SOURCE.label}
            <ExternalLink size={12} aria-hidden />
            <span className="sr-only">(נפתח בלשונית חדשה)</span>
          </a>
        </p>
      </div>
    </section>
  );
}
