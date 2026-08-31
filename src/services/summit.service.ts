// SUMIT (סאמיט) payment gateway — server-side redirect flow.
// Spec verified against https://app.sumit.co.il/swagger/v1/swagger.json (see
// Summit_Payment_Spec.md). All calls carry Credentials in the body; the PRIVATE
// API key lives only here (server), never in the browser.

const BASE = process.env.SUMIT_API_BASE || 'https://api.sumit.co.il';
const COMPANY_ID = process.env.SUMIT_COMPANY_ID;
const API_KEY = process.env.SUMIT_API_KEY;

export function summitConfigured(): boolean {
  return Boolean(COMPANY_ID && API_KEY);
}

function credentials() {
  return { CompanyID: Number(COMPANY_ID), APIKey: API_KEY };
}

// SUMIT response envelope: Status 0 = Success, 1 = BusinessError, 2 = TechnicalError.
interface SumitEnvelope<T> {
  Status: number;
  UserErrorMessage?: string | null;
  TechnicalErrorDetails?: string | null;
  Data?: T;
}

export interface BeginRedirectParams {
  itemName: string;
  amount: number;                 // ₪, VAT-inclusive
  externalIdentifier: string;     // our own payment id — echoed back
  redirectUrl: string;            // success return (backend)
  cancelRedirectUrl: string;      // cancel return (backend)
  customerEmail?: string;
  customerName?: string;
  documentDescription?: string;
}

/**
 * Creates a payment + tax document on SUMIT and returns the hosted payment-page
 * URL to redirect the user to. Throws with a Hebrew message on failure.
 */
export async function beginRedirect(p: BeginRedirectParams): Promise<{ redirectUrl: string }> {
  const body = {
    Credentials: credentials(),
    Customer: p.customerEmail || p.customerName
      ? { Name: p.customerName ?? p.customerEmail, EmailAddress: p.customerEmail }
      : undefined,
    Items: [
      { Item: { Name: p.itemName }, Quantity: 1, UnitPrice: p.amount, Description: p.documentDescription },
    ],
    VATIncluded: true,
    RedirectURL: p.redirectUrl,
    CancelRedirectURL: p.cancelRedirectUrl,
    ExternalIdentifier: p.externalIdentifier,
    MaximumPayments: 1,
    Language: 'Hebrew',                 // SUMIT enum (Accounting_Typed_Language), not 'he'
    DocumentType: 'InvoiceAndReceipt',  // issue a tax invoice + receipt
    DocumentDescription: p.documentDescription,
  };

  const r = await fetch(`${BASE}/billing/payments/beginredirect/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await r.json()) as SumitEnvelope<{ RedirectURL?: string }>;
  if (json.Status !== 0 || !json.Data?.RedirectURL) {
    console.error('[SUMIT] beginredirect failed:', json.Status, json.UserErrorMessage, json.TechnicalErrorDetails);
    throw new Error(json.UserErrorMessage || 'פתיחת התשלום נכשלה. נסו שוב.');
  }
  return { redirectUrl: json.Data.RedirectURL };
}

export interface VerifiedPayment {
  valid: boolean;
  amount: number;
  status?: string;
}

/**
 * Verifies a payment server-to-server by its SUMIT PaymentID. We only grant
 * value when this returns { valid: true } and the amount covers what was due.
 */
export async function getPayment(paymentId: number | string): Promise<VerifiedPayment | null> {
  try {
    const r = await fetch(`${BASE}/billing/payments/get/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Credentials: credentials(), PaymentID: Number(paymentId) }),
    });
    const json = (await r.json()) as SumitEnvelope<{ Payment?: { ValidPayment?: boolean; Amount?: number; Status?: string | null } }>;
    if (json.Status !== 0 || !json.Data?.Payment) {
      console.error('[SUMIT] getPayment: non-success response', { paymentId, status: json.Status, error: json.UserErrorMessage ?? json.TechnicalErrorDetails });
      return null;
    }
    const pay = json.Data.Payment;
    return { valid: Boolean(pay.ValidPayment), amount: pay.Amount ?? 0, status: pay.Status ?? undefined };
  } catch (e) {
    // A network hiccup here must never crash the return handler — it should
    // just fail closed (verified: false -> 'needs_review'), same as an
    // explicit SUMIT error. Previously this fetch was unguarded, so a
    // transient network error would throw out of paymentReturn entirely.
    console.error('[SUMIT] getPayment: request failed', { paymentId, error: e instanceof Error ? e.message : e });
    return null;
  }
}
