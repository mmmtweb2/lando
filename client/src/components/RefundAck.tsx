import { Link } from 'react-router-dom';
import { REFUND_ACK_PUBLISH, REFUND_ACK_PURCHASE, REFUND_NOTICE_SHORT } from '../legal/refundPolicy';

// ─────────────────────────────────────────────────────────────────────────────
// Pre-payment refund disclosure + the required acknowledgment that makes the
// no-refund clause stick.
//
// s.14ג(א) of חוק הגנת הצרכן obliges the עוסק to disclose the cancellation
// terms BEFORE the transaction, and the exclusion Pagey relies on (14ג(ד)(3),
// "מידע כהגדרתו בחוק המחשבים") is far harder to attack as a תנאי מקפח in a
// חוזה אחיד when the buyer ticked it themselves than when it sat unread in a
// ToS page. So this is a REAL required checkbox: the caller must keep the pay
// button disabled until `checked` is true. See client/src/legal/refundPolicy.ts
// for the full reasoning.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  /** 'publish' — releasing a page you already previewed. 'purchase' — bundles, add-on, credits. */
  variant: 'publish' | 'purchase';
  checked: boolean;
  onChange: (v: boolean) => void;
  /** Compact spacing for the denser dashboard modals. */
  compact?: boolean;
}

export default function RefundAck({ variant, checked, onChange, compact = false }: Props) {
  const label = variant === 'publish' ? REFUND_ACK_PUBLISH : REFUND_ACK_PURCHASE;

  return (
    <div className={`rounded-xl border border-slate-200 bg-slate-50 ${compact ? 'p-3' : 'p-4'} flex flex-col gap-2`} dir="rtl">
      <p className="text-[12px] leading-relaxed text-slate-500">
        {REFUND_NOTICE_SHORT}{' '}
        <Link to="/terms" target="_blank" rel="noopener noreferrer" className="font-semibold text-[#2E63F6] hover:underline">
          לתנאי השימוש המלאים
        </Link>
      </p>
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[#2E63F6] cursor-pointer"
        />
        <span className="text-[12px] leading-relaxed text-slate-700 font-medium">{label}</span>
      </label>
    </div>
  );
}
