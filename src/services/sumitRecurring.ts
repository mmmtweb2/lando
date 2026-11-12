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
import { diagLog, shapeOf } from './sumitDiag';

export interface RecurringStartParams {
  itemName: string;
  amount: number;              // ₪ per month, VAT included
  externalIdentifier: string;  // our seo_subscriptions.id — echoed back to us
  redirectUrl: string;
  cancelRedirectUrl: string;
  customerEmail: string;
}

/**
 * Optional experiments for the standing-order request, OFF by default (task #39: the first real charge
 * created NO standing order with Duration_Months alone). Nothing here changes behaviour unless set:
 *   SUMIT_RECURRENCE=<n>         adds Items[].Recurrence = n (number of cycles; UNVERIFIED what "unlimited" is)
 *   SUMIT_RECURRING_ITEM_ID=<n>  sends Items[].Item.ID = n: an item defined as RECURRING in the SUMIT dashboard
 * Invalid values (not a positive integer) are ignored.
 */
export function recurringExperiments(env: NodeJS.ProcessEnv = process.env): { recurrence?: number; itemId?: number } {
  const num = (raw: string | undefined, max: number) => {
    const n = Number((raw ?? '').trim());
    return Number.isInteger(n) && n >= 1 && n <= max ? n : undefined;
  };
  return { recurrence: num(env.SUMIT_RECURRENCE, 1200), itemId: num(env.SUMIT_RECURRING_ITEM_ID, 2_147_483_647) };
}

/**
 * Opens SUMIT's hosted payment page for a MONTHLY standing order and returns its URL.
 * UNVERIFIED: Items[].Item.Duration_Months / Items[].Duration_Months (1 = monthly), and that
 * omitting Recurrence means "until cancelled". The first real charge (2 Nov) was a plain one-time
 * payment with this exact body, so see recurringExperiments() and SUMIT_DIAG above.
 */
export async function beginRecurringRedirect(p: RecurringStartParams): Promise<{ redirectUrl: string }> {
  const x = recurringExperiments();
  const body = {
    Customer: { Name: p.customerEmail, EmailAddress: p.customerEmail, ExternalIdentifier: p.externalIdentifier },
    Items: [{
      Item: { Name: p.itemName, Duration_Months: 1, ...(x.itemId ? { ID: x.itemId } : {}) },
      Quantity: 1,
      UnitPrice: p.amount,
      Duration_Months: 1,
      ...(x.recurrence ? { Recurrence: x.recurrence } : {}),
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
  };
  const json = await summitCall<{ RedirectURL?: string }>('/billing/payments/beginredirect/', body);
  const it = body.Items[0];
  diagLog('beginredirect request', shapeOf({
    Items: [{ Item: { Duration_Months: it.Item.Duration_Months, hasID: !!x.itemId }, Quantity: it.Quantity, UnitPrice: it.UnitPrice, Duration_Months: it.Duration_Months, ...(x.recurrence ? { Recurrence: x.recurrence } : {}) }],
    VATIncluded: body.VATIncluded, MaximumPayments: body.MaximumPayments, Language: body.Language, DocumentType: body.DocumentType,
  }));
  diagLog('beginredirect response', { status: json.Status, data: shapeOf(json.Data) });
  if (json.Status !== 0 || !json.Data?.RedirectURL) {
    console.error('[SUMIT] recurring beginredirect failed:', json.Status, json.UserErrorMessage, json.TechnicalErrorDetails);
    throw new Error(json.UserErrorMessage || 'פתיחת התשלום החודשי נכשלה. נסו שוב.');
  }
  return { redirectUrl: json.Data.RedirectURL };
}

export interface SinglePaymentParams {
  itemName: string;
  amount: number;              // ₪ for the whole period, VAT included
  externalIdentifier: string;  // our seo_subscriptions.id — echoed back to us
  redirectUrl: string;
  cancelRedirectUrl: string;
  customerEmail: string;
  maxInstallments: number;     // the most payments the customer may choose on SUMIT's page
}

/**
 * Opens SUMIT's hosted payment page for ONE payment covering a whole year (annual plans): no
 * standing order, no auto-renewal. The customer may split it into installments on SUMIT's page;
 * we receive and check the total. Same body as the verified one-time flow plus the customer's
 * ExternalIdentifier (so the payment binds back to the subscription).
 * UNVERIFIED: that MaximumPayments > 1 offers installments on the hosted page, and that the
 * verified Payment.Amount of an installment payment is the TOTAL (we require it to cover the price).
 */
export async function beginSinglePaymentRedirect(p: SinglePaymentParams): Promise<{ redirectUrl: string }> {
  const json = await summitCall<{ RedirectURL?: string }>('/billing/payments/beginredirect/', {
    Customer: { Name: p.customerEmail, EmailAddress: p.customerEmail, ExternalIdentifier: p.externalIdentifier },
    Items: [{ Item: { Name: p.itemName }, Quantity: 1, UnitPrice: p.amount, Description: p.itemName }],
    VATIncluded: true,
    RedirectURL: p.redirectUrl,
    CancelRedirectURL: p.cancelRedirectUrl,
    ExternalIdentifier: p.externalIdentifier,
    MaximumPayments: Math.max(1, Math.floor(p.maxInstallments)),
    Language: 'Hebrew',
    DocumentType: 'InvoiceAndReceipt',
    DocumentDescription: p.itemName,
  });
  if (json.Status !== 0 || !json.Data?.RedirectURL) {
    console.error('[SUMIT] annual beginredirect failed:', json.Status, json.UserErrorMessage, json.TechnicalErrorDetails);
    throw new Error(json.UserErrorMessage || 'פתיחת התשלום השנתי נכשלה. נסו שוב.');
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

// ── Standing order through /billing/recurring/charge/ (12.11.2026) ───────────
//
// The hosted payment page (beginredirect) takes ONE payment; in the first real test it created no
// standing order, whatever Duration_Months said. SUMIT's own way to create one is
// /billing/recurring/charge/. So the monthly flow becomes two steps, and the customer still types
// the card only on SUMIT's page:
//   1. the first month is paid on the hosted page, exactly as before. SUMIT saves the card on the
//      customer it creates and returns the customer's id (OG-CustomerID);
//   2. once that payment is verified, we ask SUMIT for a standing order on that saved card, whose
//      FIRST charge is one period later (Date_Start).
//
// OFF unless SUMIT_STANDING_ORDER=after_payment. UNVERIFIED against live SUMIT (field names are
// from two third-party descriptions of its published schema, not from a call we made):
//   • that /billing/recurring/charge/ accepts a customer by ID and uses the card saved on it;
//   • that Date_Start postpones the first charge. If it does NOT, SUMIT charges at once and the
//     response carries a Payment: we then log an ALERT with the amount, and report `chargedNow`.
//     This is why the first run must be the 1-shekel test (SEO_TEST_PRICE), never a real customer.

export const standingOrderAfterPayment = (env: NodeJS.ProcessEnv = process.env): boolean => env.SUMIT_STANDING_ORDER === 'after_payment';

export interface StandingOrderParams { customerId: string; itemName: string; amount: number; firstCharge: Date }

/** YYYY-MM-DD in Israel, the day SUMIT should make the first charge. */
export function sumitDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** The request body. Throws on anything that could create a wrong order (bad id, bad amount, a start in the past). */
export function standingOrderBody(p: StandingOrderParams, now = new Date()): Record<string, unknown> {
  const id = Number(p.customerId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('standing order: bad customer id');
  if (!(p.amount > 0) || p.amount > 100_000) throw new Error('standing order: bad amount');
  if (!(p.firstCharge.getTime() > now.getTime() + 24 * 60 * 60 * 1000)) throw new Error('standing order: first charge must be at least a day ahead');
  return {
    Customer: { ID: id, SearchMode: 1 },   // 1 = None: use exactly this customer, never search or create another
    Items: [{
      Item: { Name: p.itemName, Duration_Months: 1 },
      Quantity: 1,
      UnitPrice: p.amount,
      Duration_Months: 1,
      Recurrence: 0,                        // 0 = until cancelled
      Date_Start: sumitDate(p.firstCharge),
      Description: p.itemName,
    }],
    VATIncluded: true,
  };
}

export interface StandingOrderResult { ok: boolean; recurringItemId: string | null; chargedNow: { paymentId: string | null; amount: number | null } | null; error: string | null }

/** Reads SUMIT's answer. A Payment in it means SUMIT charged the card now, which we did not ask for. */
export function readStandingOrder(json: { Status?: number; UserErrorMessage?: string | null; TechnicalErrorDetails?: string | null; Data?: any }): StandingOrderResult {
  if (json.Status !== 0) return { ok: false, recurringItemId: null, chargedNow: null, error: String(json.UserErrorMessage || json.TechnicalErrorDetails || `status ${json.Status}`).slice(0, 200) };
  const d = json.Data ?? {};
  const ids = d.RecurringCustomerItemIDs ?? d.Payment?.RecurringCustomerItemIDs;
  const first = Array.isArray(ids) ? ids[0] : ids;
  const pay = d.Payment;
  const charged = pay && (pay.ValidPayment === true || Number(pay.Amount) > 0) ? { paymentId: pay.ID != null ? String(pay.ID) : null, amount: Number.isFinite(Number(pay.Amount)) ? Number(pay.Amount) : null } : null;
  return { ok: first != null, recurringItemId: first != null ? String(first) : null, chargedNow: charged, error: first != null ? null : 'no standing order id in the answer' };
}

type Call = typeof summitCall;

/** Asks SUMIT for the standing order. Never throws: the caller already gave the customer what they paid for. */
export async function createStandingOrder(p: StandingOrderParams, now = new Date(), call: Call = summitCall): Promise<StandingOrderResult> {
  try {
    const body = standingOrderBody(p, now);
    const json = await call('/billing/recurring/charge/', body);
    diagLog('recurring/charge request', shapeOf(body));
    diagLog('recurring/charge response', { status: json.Status, data: shapeOf(json.Data) });
    const r = readStandingOrder(json as never);
    if (!r.ok) console.error('[SUMIT] ALERT standing order was NOT created:', r.error);
    if (r.chargedNow) console.error('[SUMIT] ALERT SUMIT charged the card NOW while creating the standing order (Date_Start did not postpone it) — check for a double charge', r.chargedNow);
    return r;
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 200) : 'unknown';
    console.error('[SUMIT] ALERT standing order request failed:', error);
    return { ok: false, recurringItemId: null, chargedNow: null, error };
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
