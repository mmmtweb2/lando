// What the discount-code box does when the thing being bought changes under it (README part 151).
// QA 23.11: switching monthly <-> annual kept the code in the box, dropped the discount and said nothing.
// Now the code is re-checked for the new plan automatically: it stays applied when it is valid there,
// otherwise the box says why (e.g. "הקוד הזה חל רק על המסלול החודשי") and marks it "לא הוחל".
// Pure, so scripts/test-qa-billing.ts can check it.

export type CouponBoxStatus = 'applied' | 'refused';

export interface CouponBoxState {
  /** The normalized code the customer last applied or tried. */
  code: string;
  /** The purchase it was checked for (`purpose|references`). */
  key: string;
  status: CouponBoxStatus;
  /** refused: the server's sentence. */
  error?: string;
  /** refused after it HAD been applied to another plan: shown as "לא הוחל" next to the code. */
  wasApplied?: boolean;
}

/** The purchase key the box checks a code against. */
export function couponKey(purpose: string, references: (string | undefined)[]): string {
  return `${purpose}|${references.map(r => r ?? '').join('|')}`;
}

/** True when the purchase changed and a code is in play: check it again for the new purchase. */
export function needsRecheck(state: CouponBoxState | null, key: string): boolean {
  return !!state && !!state.code && state.key !== key;
}

/** Is the code applied to THIS purchase? (A code applied to another plan does not count.) */
export function appliedFor(state: CouponBoxState | null, key: string): string | null {
  return state && state.status === 'applied' && state.key === key ? state.code : null;
}

/** The state after the server answered for `key`. */
export function afterCheck(
  prev: CouponBoxState | null,
  key: string,
  code: string,
  result: { ok: true } | { ok: false; error: string },
): CouponBoxState {
  if (result.ok) return { code, key, status: 'applied' };
  return { code, key, status: 'refused', error: result.error, wasApplied: prev?.status === 'applied' || !!prev?.wasApplied };
}
