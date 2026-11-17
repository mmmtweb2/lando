import { Star } from 'lucide-react';

/** Read-only stars with text for screen readers. */
export function StarsView({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} מתוך 5 כוכבים`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} aria-hidden className={i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'} />
      ))}
    </span>
  );
}

/** Five real radio buttons, keyboard friendly. */
export function StarsInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div role="radiogroup" aria-label="דירוג בכוכבים" className="flex gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i} type="button" role="radio" aria-checked={value === i} aria-label={`${i} כוכבים`}
          onClick={() => onChange(i)}
          className="rounded-lg p-1 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-300"
        >
          <Star size={30} aria-hidden className={i <= value ? 'fill-amber-400 text-amber-400' : 'fill-slate-100 text-slate-300'} />
        </button>
      ))}
    </div>
  );
}
