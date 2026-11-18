// The refund window of the Google-promotion subscription (decision 17.11.2026, migration 051).
// Pure rules, no I/O. A customer who cancels within REFUND_WINDOW_DAYS of the FIRST payment of the
// subscription gets that payment back in full: monthly or annual, once per account, ever. After the
// window, or once the subscription has been renewed even once, cancelling works as before (no refund).
// The money itself is returned by a human in the SUMIT dashboard: the server only records the request.

export const REFUND_WINDOW_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

export interface ChargeEvent {
  kind: string;
  sumit_payment_id: string | null;
  amount: number | string | null;
  created_at: string;
}

export type RefundBlock = 'not_active' | 'no_payment' | 'not_first' | 'expired' | 'used' | 'unavailable';

export interface RefundOffer {
  eligible: boolean;
  /** The amount that would be returned (the first payment), when eligible. */
  amount: number | null;
  paymentId: string | null;
  /** Last moment the refund applies. */
  until: Date | null;
  reason: RefundBlock | null;
}

const no = (reason: RefundBlock, until: Date | null = null): RefundOffer => ({ eligible: false, amount: null, paymentId: null, until, reason });

/**
 * @param status    the subscription's status (only a paid, live subscription can be refunded)
 * @param events    all events of this subscription (seo_subscription_events)
 * @param hadRefund the account already has a refund request (any status)
 */
export function refundOffer(status: string, events: ChargeEvent[], hadRefund: boolean, now = new Date()): RefundOffer {
  if (status !== 'active' && status !== 'past_due') return no('not_active');
  const charges = events
    .filter((e) => e.kind === 'charge_ok' && Number(e.amount) > 0)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  if (!charges.length) return no('no_payment');
  if (charges.length > 1) return no('not_first');
  const first = charges[0];
  const until = new Date(new Date(first.created_at).getTime() + REFUND_WINDOW_DAYS * DAY);
  if (Number.isNaN(until.getTime())) return no('no_payment');
  if (now.getTime() > until.getTime()) return no('expired', until);
  if (hadRefund) return no('used', until);
  return { eligible: true, amount: Number(first.amount), paymentId: first.sumit_payment_id, until, reason: null };
}
