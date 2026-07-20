import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { beginRedirect, getPayment, summitConfigured } from '../services/summit.service';
import { publishPageById } from './landing.controller';
import { CREDIT_PACKS, grantCreditsForPack } from './user.controller';

// Where SUMIT sends the browser back (the backend return handler).
const API_URL = (process.env.PUBLIC_API_URL || 'http://localhost:3000').replace(/\/$/, '');
// Where we send the user after we finish handling the return (the client app).
const APP_URL = (process.env.PUBLIC_APP_URL || 'http://localhost:5173').replace(/\/$/, '');

const PAGE_PRICE = 249;

interface PaymentRow {
  id: string;
  user_email: string;
  purpose: string;
  reference: string | null;
  amount: number;
  status: string;
}

// ─── Start a payment → returns a SUMIT redirect URL ───────────────────────────
export async function startPayment(req: Request, res: Response): Promise<void> {
  const email = req.authEmail;
  if (!email) { res.status(401).json({ error: 'נדרשת התחברות.' }); return; }

  if (!summitConfigured()) {
    res.status(503).json({ error: 'הסליקה אינה מוגדרת עדיין. חסרים SUMIT_COMPANY_ID / SUMIT_API_KEY.' });
    return;
  }

  const { purpose, reference } = req.body as { purpose?: string; reference?: string };

  let amount: number;
  let itemName: string;

  if (purpose === 'publish') {
    if (!reference) { res.status(400).json({ error: 'reference (page id) required' }); return; }
    const { data: page } = await supabase
      .from('landing_pages')
      .select('owner_email, status, business_name')
      .eq('id', reference)
      .single();
    if (!page || (page as { owner_email?: string }).owner_email?.toLowerCase() !== email) {
      res.status(403).json({ error: 'אין לך הרשאה לפרסם דף זה.' });
      return;
    }
    if ((page as { status?: string }).status === 'published') {
      res.status(409).json({ error: 'הדף כבר מפורסם.' });
      return;
    }
    amount = PAGE_PRICE;
    itemName = `דף נחיתה - ${(page as { business_name?: string }).business_name ?? 'Lando'}`;
  } else if (purpose === 'credits') {
    const pack = reference ? CREDIT_PACKS[reference] : undefined;
    if (!pack) { res.status(400).json({ error: `pack must be one of: ${Object.keys(CREDIT_PACKS).join(', ')}` }); return; }
    amount = pack.price;
    itemName = `${pack.credits} קרדיטים - Lando`;
  } else {
    res.status(400).json({ error: "purpose must be 'publish' or 'credits'" });
    return;
  }

  // Persist the pending intent so the return handler knows what to grant.
  const { data: pay, error } = await supabase
    .from('payments')
    .insert({ user_email: email, purpose, reference: reference ?? null, amount, status: 'pending' })
    .select('id')
    .single();
  if (error || !pay) { res.status(500).json({ error: error?.message ?? 'DB error' }); return; }

  const payId = (pay as { id: string }).id;
  try {
    const { redirectUrl } = await beginRedirect({
      itemName,
      amount,
      externalIdentifier: payId,
      redirectUrl: `${API_URL}/api/payments/return?ref=${payId}`,
      cancelRedirectUrl: `${API_URL}/api/payments/return?ref=${payId}&cancel=1`,
      customerEmail: email,
      documentDescription: itemName,
    });
    res.json({ redirectUrl });
  } catch (e) {
    await supabase.from('payments').update({ status: 'failed' }).eq('id', payId);
    res.status(502).json({ error: e instanceof Error ? e.message : 'פתיחת התשלום נכשלה.' });
  }
}

// ─── SUMIT redirects the browser here after payment ───────────────────────────
export async function paymentReturn(req: Request, res: Response): Promise<void> {
  const clientUrl = (status: string) => `${APP_URL}/dashboard?payment=${status}`;
  const ref = req.query.ref as string | undefined;
  const cancel = req.query.cancel as string | undefined;

  if (!ref) { res.redirect(clientUrl('error')); return; }

  const { data: payData } = await supabase.from('payments').select('*').eq('id', ref).single();
  const pay = payData as PaymentRow | null;
  if (!pay) { res.redirect(clientUrl('error')); return; }

  if (pay.status === 'paid') { res.redirect(clientUrl('success')); return; }  // idempotent
  if (cancel) {
    await supabase.from('payments').update({ status: 'failed' }).eq('id', ref);
    res.redirect(clientUrl('cancelled'));
    return;
  }

  // The exact SUMIT return param carrying the PaymentID is confirmed against the
  // test terminal — log everything so we can see it, and try the likely names.
  console.log('[PAYMENT RETURN] query params:', JSON.stringify(req.query));
  const q = req.query as Record<string, string>;
  const sumitPaymentId =
    q.OGPaymentID || q.PaymentID || q.paymentid || q['og-paymentid'] || q.OGPaymentId || q.PaymentId;

  let verified = false;
  if (sumitPaymentId) {
    const p = await getPayment(sumitPaymentId);
    if (p && p.valid && p.amount + 0.001 >= pay.amount) verified = true;
  }

  if (!verified) {
    // Never grant on an unconfirmed payment — flag for review instead.
    await supabase
      .from('payments')
      .update({ status: 'needs_review', sumit_payment_id: sumitPaymentId ? String(sumitPaymentId) : null })
      .eq('id', ref);
    res.redirect(clientUrl('review'));
    return;
  }

  // Grant the purchased value.
  let ok = false;
  if (pay.purpose === 'publish' && pay.reference) {
    ok = (await publishPageById(pay.reference)) !== null;
  } else if (pay.purpose === 'credits' && pay.reference) {
    ok = (await grantCreditsForPack(pay.user_email, pay.reference)) !== null;
  }

  await supabase
    .from('payments')
    .update({
      status: ok ? 'paid' : 'needs_review',
      sumit_payment_id: String(sumitPaymentId),
      paid_at: ok ? new Date().toISOString() : null,
    })
    .eq('id', ref);

  res.redirect(clientUrl(ok ? 'success' : 'review'));
}
