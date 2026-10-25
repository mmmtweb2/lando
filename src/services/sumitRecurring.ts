// SUMIT standing orders (הוראת קבע) — the only file that knows SUMIT's recurring field names.
//
// VERIFICATION STATUS: the one-time flow (summit.service.ts) was verified against SUMIT's
// swagger. The recurring field names below come from a third-party description of SUMIT's
// API (github.com/Digitizers/sumit-api), because the swagger readable from our tooling did not
// include /billing/recurring/*. Every name marked UNVERIFIED must be confirmed by the first
// real, small test charge before the feature is switched on for customers. If a name is wrong,
// SUMIT answers with a business error (we log it and fail closed) — it cannot silently charge
// the wrong amount, because amount and duration are sent explicitly and re-checked on return.

import { summitCall } from './summit.service';

export interface RecurringStartParams {
  itemName: string;
  amount: number;              // ₪ per month, VAT included
  externalIdentifier: string;  // our seo_subscriptions.id — echoed back to us
  redirectUrl: string;
  cancelRedirectUrl: string;
  customerEmail: string;
}

/**
 * Opens SUMIT's hosted payment page for a MONTHLY standing order and returns its URL.
 * UNVERIFIED: Items[].Item.Duration_Months / Items[].Duration_Months (1 = monthly), and that
 * omitting Recurrence means "until cancelled".
 */
export async function beginRecurringRedirect(p: RecurringStartParams): Promise<{ redirectUrl: string }> {
  const json = await summitCall<{ RedirectURL?: string }>('/billing/payments/beginredirect/', {
    Customer: { Name: p.customerEmail, EmailAddress: p.customerEmail, ExternalIdentifier: p.externalIdentifier },
    Items: [{
      Item: { Name: p.itemName, Duration_Months: 1 },
      Quantity: 1,
      UnitPrice: p.amount,
      Duration_Months: 1,
      Description: p.itemName,
    }],
    VATIncluded: true,
    RedirectURL: p.redirectUrl,
    CancelRedirectURL: p.cancelRedirectUrl,
    ExternalIdentifier: p.externalIdentifier,
    MaximumPayments: 1,
    Language: 'Hebrew',
    DocumentType: 'InvoiceAndReceipt',
    DocumentDescription: p.itemName,
  });
  if (json.Status !== 0 || !json.Data?.RedirectURL) {
    console.error('[SUMIT] recurring beginredirect failed:', json.Status, json.UserErrorMessage, json.TechnicalErrorDetails);
    throw new Error(json.UserErrorMessage || 'פתיחת התשלום החודשי נכשלה. נסו שוב.');
  }
  return { redirectUrl: json.Data.RedirectURL };
}

/**
 * Stops future charges of a standing order. Returns true only when SUMIT confirmed it.
 * UNVERIFIED: the request field names (Customer.ID, RecurringCustomerItemID).
 */
export async function cancelRecurring(customerId: string | null, recurringItemId: string | null): Promise<boolean> {
  if (!recurringItemId) return false;
  try {
    const json = await summitCall('/billing/recurring/cancel/', {
      ...(customerId ? { Customer: { ID: Number(customerId) } } : {}),
      RecurringCustomerItemID: Number(recurringItemId),
    });
    if (json.Status !== 0) {
      console.error('[SUMIT] recurring cancel failed:', json.Status, json.UserErrorMessage, json.TechnicalErrorDetails);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[SUMIT] recurring cancel request failed:', e instanceof Error ? e.message : e);
    return false;
  }
}

/** Case/separator-insensitive lookup in a flat key-value bag (query string, form body, JSON). */
export function pickField(bag: Record<string, unknown>, ...names: string[]): string | undefined {
  const wanted = new Set(names.map(n => n.toLowerCase().replace(/[^a-z0-9]/g, '')));
  for (const [key, value] of Object.entries(bag)) {
    const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!wanted.has(k)) continue;
    const v = Array.isArray(value) ? value[0] : value;
    if ((typeof v === 'string' || typeof v === 'number') && String(v).trim()) return String(v).trim();
  }
  return undefined;
}
