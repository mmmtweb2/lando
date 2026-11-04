// Binding a verified SUMIT payment to the transaction WE meant it for.
//
// getPayment() proves that SUMIT knows a PaymentID, that it is valid and that the amount is high
// enough. It does NOT prove the payment belongs to the checkout in front of us: the return
// endpoints are public and take the PaymentID from the query string, so anyone holding ANY valid
// payment of sufficient amount (their own earlier one, a cheaper-purpose one, even someone
// else's PaymentID) could present it against a different pending payment/subscription.
// "One PaymentID settles one row" (migration 010 / 044) stops the SAME id being used twice, but
// not an unrelated paid id being used once. The missing link is what we told SUMIT when the
// checkout was opened: ExternalIdentifier = our payments.id / seo_subscriptions.id (also set on the
// SUMIT customer for subscriptions). SUMIT stores it, so the payment must echo it back.
//
// Because the exact response shape of /billing/payments/get/ has not been verified against live
// data, the identifier is looked up defensively (any key named ExternalIdentifier, up to 3 levels
// deep in Data). Decision table:
//   identifiers present, one equals the expected id   -> OK
//   identifiers present, none equals it               -> REJECT  (always)
//   no identifier in the response at all              -> REJECT when SUMIT_REQUIRE_BINDING=true,
//                                                         otherwise accept with a loud warning
//                                                         (so deploying this cannot break checkout
//                                                         if SUMIT does not return the field;
//                                                         flip the flag once logs show it does).

export function bindingRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.SUMIT_REQUIRE_BINDING ?? '').trim().toLowerCase() === 'true';
}

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Every non-empty ExternalIdentifier found anywhere in `data` (depth <= 3), as trimmed strings. */
export function extractExternalIdentifiers(data: unknown, depth = 0, out: string[] = []): string[] {
  if (!data || typeof data !== 'object' || depth > 3) return out;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (norm(k) === 'externalidentifier' && (typeof v === 'string' || typeof v === 'number')) {
      const s = String(v).trim();
      if (s) out.push(s);
    } else if (v && typeof v === 'object') {
      extractExternalIdentifiers(v, depth + 1, out);
    }
  }
  return out;
}

export type BindingResult =
  | { ok: true; state: 'matched' | 'unverifiable' }
  | { ok: false; state: 'mismatch' | 'absent'; reason: string };

export function evaluateBinding(found: readonly string[], expectedId: string, required = bindingRequired()): BindingResult {
  const want = expectedId.trim().toLowerCase();
  if (found.length > 0) {
    return found.some((f) => f.trim().toLowerCase() === want)
      ? { ok: true, state: 'matched' }
      : { ok: false, state: 'mismatch', reason: 'SUMIT payment belongs to a different ExternalIdentifier than this checkout' };
  }
  if (required) {
    return { ok: false, state: 'absent', reason: 'SUMIT payment carries no ExternalIdentifier and SUMIT_REQUIRE_BINDING=true' };
  }
  return { ok: true, state: 'unverifiable' };
}

let warnedUnverifiable = 0;
/** Logs (rate-limited) that a payment was accepted without being bindable. */
export function noteUnverifiable(kind: string, expectedId: string): void {
  if (warnedUnverifiable++ % 20 === 0) {
    console.warn(`[PAYMENT BINDING] ${kind} ${expectedId}: SUMIT returned no ExternalIdentifier for this payment, accepted on ValidPayment+amount only. ` +
      'Confirm SUMIT echoes ExternalIdentifier, then set SUMIT_REQUIRE_BINDING=true. (logged every 20th time)');
  }
}
