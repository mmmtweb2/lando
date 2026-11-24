import { useEffect, useRef, useState } from 'react';
import { Check, Tag } from 'lucide-react';
import { authFetch } from '../lib/api';
import { afterCheck, appliedFor, couponKey, needsRecheck, type CouponBoxState } from '../lib/couponRecheck';

/**
 * The customer-facing coupon box: type a code, press "החל", see what the price
 * becomes.
 *
 * It is a PREVIEW and nothing more. /api/payments/validate-coupon is read-only —
 * it consumes no redemption — and the discount only becomes real when the code
 * is passed to /api/payments/start as `couponCode`, where the server re-checks
 * every rule from scratch and prices the charge itself. Nothing shown here is
 * trusted by the backend, so a tampered client can only mislead its own user.
 */

export interface CouponQuote {
  baseAmount: number;
  discountAmount: number;
  finalAmount: number;
  /** Google-promotion subscription only: 'first' = only the first payment is discounted, 'forever' = every payment. */
  seoDuration?: 'first' | 'forever';
  /** Google-promotion subscription only: what each later charge will be. */
  recurringAmount?: number;
  /** The price stopped at the ₪1 floor (a 100% code): the page says what the ₪1 is for (README part 151). */
  minCharge?: boolean;
}

interface Props {
  purpose: 'publish' | 'renew' | 'credits' | 'bundle' | 'seo_monthly' | 'seo_annual';
  /**
   * The purchase variants to price. One entry for a single-price purpose
   * (`[pageId]`, or `[undefined]` when the purpose has no reference), or one per
   * option when a single modal offers several (the bundle and credit modals).
   * Validity is identical across them — same coupon, same purpose — so only the
   * resulting price differs per entry.
   */
  references: (string | undefined)[];
  /** Fired with the applied code + a quote per reference, or null when cleared. */
  onChange: (applied: { code: string; quotes: Record<string, CouponQuote> } | null) => void;
  className?: string;
  /** Starts as a quiet "יש לכם קוד הנחה?" link that opens the box (the subscription checkout). */
  collapsible?: boolean;
}

/** Key used in the quotes map for a reference-less purpose. */
export const NO_REFERENCE = '';

export default function CouponField({ purpose, references, onChange, className = '', collapsible = false }: Props) {
  const [open, setOpen] = useState(!collapsible);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // The last code applied or tried, and the purchase it was checked for (lib/couponRecheck.ts).
  const [box, setBox] = useState<CouponBoxState | null>(null);

  // When the thing being bought changes (monthly <-> annual), a code in play is checked AGAIN for the new
  // purchase: it stays applied if it is valid there, else the box says why and marks it "לא הוחל"
  // (README part 151). The parent's quotes are keyed by reference, so a stale quote is never shown meanwhile,
  // and the server re-checks the code at checkout regardless.
  const refKey = couponKey(purpose, references);
  const appliedCode = appliedFor(box, refKey);
  const rechecking = needsRecheck(box, refKey);
  const seq = useRef(0);

  async function check(raw: string, prev: CouponBoxState | null) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const mine = ++seq.current;
    const key = refKey;
    setBusy(true);
    try {
      const results = await Promise.all(references.map(async (reference) => {
        const r = await authFetch('/api/payments/validate-coupon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: trimmed, purpose, reference }),
        });
        const data = await r.json().catch(() => ({})) as {
          valid?: boolean; code?: string; error?: string;
          baseAmount?: number; discountAmount?: number; finalAmount?: number;
          seoDuration?: 'first' | 'forever'; recurringAmount?: number; minCharge?: boolean;
        };
        if (!r.ok || !data.valid) throw new Error(data.error ?? 'לא הצלחנו להחיל את הקוד. נסו שוב.');
        return [reference ?? NO_REFERENCE, {
          baseAmount: data.baseAmount ?? 0,
          discountAmount: data.discountAmount ?? 0,
          finalAmount: data.finalAmount ?? 0,
          ...(data.seoDuration ? { seoDuration: data.seoDuration } : {}),
          ...(typeof data.recurringAmount === 'number' ? { recurringAmount: data.recurringAmount } : {}),
          ...(data.minCharge ? { minCharge: true } : {}),
        }, data.code ?? trimmed.toUpperCase()] as const;
      }));
      if (mine !== seq.current) return;   // a newer check (another plan, another code) won
      const quotes: Record<string, CouponQuote> = {};
      for (const [k, quote] of results) quotes[k] = quote;
      const normalized = results[0]?.[2] ?? trimmed.toUpperCase();
      setBox(afterCheck(prev, key, normalized, { ok: true }));
      setCode(normalized);
      onChange({ code: normalized, quotes });
    } catch (e) {
      if (mine !== seq.current) return;
      setBox(afterCheck(prev, key, trimmed.toUpperCase(), { ok: false, error: e instanceof Error ? e.message : 'לא הצלחנו להחיל את הקוד. נסו שוב.' }));
      onChange(null);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (needsRecheck(box, refKey)) void check(box!.code, box);
    // Only the purchase changing triggers this; `check` reads the current props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey]);

  function clear() {
    seq.current++;
    setCode('');
    setBox(null);
    setBusy(false);
    onChange(null);
  }

  if (appliedCode && !rechecking) {
    return (
      <div className={`flex min-h-[44px] items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 ${className}`} dir="rtl">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-800">
          <Check size={14} className="text-emerald-600 flex-shrink-0" />
          הקוד <span className="font-mono" dir="ltr">{appliedCode}</span> הוחל
        </span>
        <button type="button" onClick={clear}
          className="min-h-[44px] px-2 text-xs font-medium text-emerald-700 hover:underline flex-shrink-0">
          הסרה
        </button>
      </div>
    );
  }

  if (!open && !box) {
    // A clear control, still secondary to the payment button: outlined, full 44px target (QA 23.11).
    return (
      <div className={className} dir="rtl">
        <button type="button" onClick={() => setOpen(true)} aria-expanded={false}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:bg-slate-50">
          <Tag size={15} aria-hidden className="text-slate-500" />
          יש לכם קוד הנחה?
        </button>
      </div>
    );
  }

  const refused = box && box.status === 'refused' && box.key === refKey ? box : null;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`} dir="rtl">
      <div className="flex items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void check(code, null); } }}
          placeholder={collapsible ? 'קוד הנחה' : 'קוד קופון (אופציונלי)'}
          aria-label="קוד הנחה"
          aria-invalid={refused ? true : undefined}
          aria-describedby={refused ? 'coupon-error' : undefined}
          autoFocus={collapsible && !box}
          dir="ltr"
          className={`min-h-[44px] flex-1 rounded-lg border bg-white px-3 py-2 text-sm font-mono text-slate-900 outline-none focus:border-[#2E63F6] focus:ring-2 focus:ring-[#2E63F6]/15 transition text-center placeholder:font-sans placeholder:text-slate-400 ${refused ? 'border-red-300' : 'border-slate-200'}`}
        />
        <button type="button" onClick={() => void check(code, null)} disabled={busy || !code.trim()}
          aria-busy={busy || undefined}
          className={`min-h-[44px] flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium border transition ${busy ? 'border-[#2E63F6]/30 bg-[#2E63F6]/5 text-[#2E63F6] cursor-wait' : 'text-slate-700 border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40'}`}>
          {busy ? 'בודקים…' : 'החל קופון'}
        </button>
      </div>
      {busy && rechecking && <p role="status" className="text-xs text-slate-500">בודקים אם הקוד חל גם על הבחירה החדשה…</p>}
      {refused && (
        <p id="coupon-error" role="alert" className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-red-700">
          <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-800">הקוד לא הוחל</span>
          <span>{refused.error}</span>
        </p>
      )}
    </div>
  );
}
