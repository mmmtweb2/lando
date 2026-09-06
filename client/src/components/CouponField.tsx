import { useState } from 'react';
import { Check } from 'lucide-react';
import { authFetch } from '../lib/api';

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
}

interface Props {
  purpose: 'publish' | 'renew' | 'credits' | 'bundle';
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
}

/** Key used in the quotes map for a reference-less purpose. */
export const NO_REFERENCE = '';

export default function CouponField({ purpose, references, onChange, className = '' }: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ code: string; key: string } | null>(null);

  // If the thing being bought changes under us, a previously applied quote is
  // stale, so the applied state is remembered together with the key it was
  // fetched for and simply stops counting when that key changes (no effect, no
  // cascading render). The parent is safe either way: its quotes map is keyed
  // by reference, so a stale quote can never be shown against a new product,
  // and the code itself is re-validated server-side at checkout regardless.
  const refKey = `${purpose}|${references.join('|')}`;
  const appliedCode = applied && applied.key === refKey ? applied.code : null;

  async function apply() {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
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
        };
        if (!r.ok || !data.valid) throw new Error(data.error ?? 'הקופון אינו תקף.');
        return [reference ?? NO_REFERENCE, {
          baseAmount: data.baseAmount ?? 0,
          discountAmount: data.discountAmount ?? 0,
          finalAmount: data.finalAmount ?? 0,
        }, data.code ?? trimmed.toUpperCase()] as const;
      }));

      const quotes: Record<string, CouponQuote> = {};
      for (const [key, quote] of results) quotes[key] = quote;
      const normalized = results[0]?.[2] ?? trimmed.toUpperCase();
      setApplied({ code: normalized, key: refKey });
      onChange({ code: normalized, quotes });
    } catch (e) {
      setApplied(null);
      onChange(null);
      setError(e instanceof Error ? e.message : 'הקופון אינו תקף.');
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setCode('');
    setApplied(null);
    setError(null);
    onChange(null);
  }

  if (appliedCode) {
    return (
      <div className={`flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 ${className}`} dir="rtl">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-800">
          <Check size={14} className="text-emerald-600 flex-shrink-0" />
          הקופון <span className="font-mono" dir="ltr">{appliedCode}</span> הופעל
        </span>
        <button type="button" onClick={clear}
          className="text-xs font-medium text-emerald-700 hover:underline flex-shrink-0">
          הסרה
        </button>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`} dir="rtl">
      <div className="flex items-center gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void apply(); } }}
          placeholder="קוד קופון (אופציונלי)"
          dir="ltr"
          className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono text-slate-900 outline-none focus:border-[#2E63F6] focus:ring-2 focus:ring-[#2E63F6]/15 transition text-center placeholder:font-sans placeholder:text-slate-400"
        />
        <button type="button" onClick={() => void apply()} disabled={busy || !code.trim()}
          className="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium text-slate-700 border border-slate-200 bg-white hover:bg-slate-50 transition disabled:opacity-40">
          {busy ? '…' : 'החל קופון'}
        </button>
      </div>
      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
