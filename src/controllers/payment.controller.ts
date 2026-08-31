import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { beginRedirect, getPayment, summitConfigured } from '../services/summit.service';
import { publishPageById } from './landing.controller';
import { CREDIT_PACKS, grantCreditsForPack } from './user.controller';
import { PLANS, PlanKey } from '../config/plans';
import { activatePlan, canPublishUnderPlan } from '../services/plan.service';

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
  sumit_payment_id: string | null;
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
    // Never open a 249₪ charge for something the customer's plan already
    // covers. The client's publish flow tries the free plan-publish endpoint
    // first, but that is a client-side courtesy — a direct call to this
    // endpoint (or a stale tab) could still start a real charge for a page the
    // user is entitled to publish for free.
    try {
      const { covered } = await canPublishUnderPlan(email);
      if (covered) {
        res.status(409).json({
          coveredByPlan: true,
          error: 'המסלול שלך כבר מכסה את פרסום הדף — אין צורך בתשלום. פרסמו את הדף מתוך הדף עצמו.',
        });
        return;
      }
    } catch (e) {
      // Fail OPEN to the paid flow: if plan status can't be read we must not
      // block a customer who genuinely needs to pay. publishLandingPage
      // re-checks coverage on its own path anyway.
      console.error('[PAYMENT] plan-coverage pre-check failed, continuing to paid flow:', e);
    }
    amount = PAGE_PRICE;
    itemName = `דף נחיתה - ${(page as { business_name?: string }).business_name ?? 'Pagey'}`;
  } else if (purpose === 'credits') {
    const pack = reference ? CREDIT_PACKS[reference] : undefined;
    if (!pack) { res.status(400).json({ error: `pack must be one of: ${Object.keys(CREDIT_PACKS).join(', ')}` }); return; }
    amount = pack.price;
    itemName = `${pack.credits} קרדיטים - Pagey`;
  } else if (purpose === 'plan') {
    const plan = reference ? PLANS[reference as PlanKey] : undefined;
    if (!plan || plan.key === 'free') {
      res.status(400).json({ error: `plan must be one of: ${Object.keys(PLANS).filter((k) => k !== 'free').join(', ')}` });
      return;
    }
    amount = plan.priceYear;
    itemName = `מנוי ${plan.label} - Pagey (שנה)`;
  } else {
    res.status(400).json({ error: "purpose must be 'publish', 'credits' or 'plan'" });
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

// Every query-param key SUMIT (or any proxy/CDN in front of it) might use for
// the PaymentID, case- and separator-insensitive: normalize each key to
// lowercase-alnum-only and match against "paymentid"/"ogpaymentid". This
// replaced a short list of guessed exact names (kept as comments below for
// context) after a real production payment failed verification because the
// actual returned key didn't match any of them — we don't yet know the exact
// key SUMIT used without seeing that request's logs, so this widens the net
// instead of guessing another fixed string.
function extractSumitPaymentId(query: Record<string, unknown>): string | undefined {
  // Previously guessed exact names: OG-PaymentID, OGPaymentID, PaymentID,
  // paymentid, og-paymentid, OGPaymentId, PaymentId.
  for (const [key, value] of Object.entries(query)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if ((normalized === 'paymentid' || normalized === 'ogpaymentid') && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * True when this SUMIT PaymentID has already been consumed by a DIFFERENT
 * payment row.
 *
 * Why this matters: /api/payments/return is public and takes the SUMIT
 * PaymentID straight off the query string. Without this check, a user who has
 * genuinely paid once can start a second (cheaper or equal) payment, let it sit
 * as 'pending', then hand-craft
 *     /api/payments/return?ref=<second row>&OG-PaymentID=<first, real payment>
 * — SUMIT would confirm that PaymentID as valid with a sufficient amount, and
 * the second purchase would be granted for free. Binding each SUMIT PaymentID
 * to exactly one payment row closes that replay.
 *
 * A partial unique index enforces the same rule at the DB level
 * (migrations/010_payments_idempotency.sql); this check is what makes the
 * failure a clean 'needs_review' instead of a 500.
 */
async function sumitPaymentIdAlreadyConsumed(sumitPaymentId: string, exceptRowId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('payments')
    .select('id')
    .eq('sumit_payment_id', sumitPaymentId)
    .neq('id', exceptRowId)
    .in('status', ['paid', 'processing'])
    .limit(1);
  if (error) {
    // Fail CLOSED: if we cannot prove the id is unused, do not grant.
    console.error('[PAYMENT] reuse check failed:', error.message);
    return true;
  }
  return (data ?? []).length > 0;
}

/** Grants the purchased value for an already-verified payment. Shared by the
 * normal return-redirect flow and the admin re-verify/force-activate tools,
 * so there's exactly one place that knows how to fulfil each purpose. */
async function grantPaymentValue(pay: PaymentRow): Promise<boolean> {
  if (pay.purpose === 'publish' && pay.reference) {
    // Re-check ownership at grant time, not just at startPayment time: the
    // grant path is also reachable from the admin tools, and the page could
    // have been deleted or (in future) transferred in between. Publishing a
    // page that is not the payer's would hand someone else's page a paid
    // publish off this payment.
    const { data: target } = await supabase
      .from('landing_pages')
      .select('owner_email')
      .eq('id', pay.reference)
      .single();
    const targetOwner = ((target as { owner_email?: string | null } | null)?.owner_email ?? '').toLowerCase();
    if (!targetOwner || targetOwner !== pay.user_email.trim().toLowerCase()) {
      console.error('[PAYMENT] refusing to publish — page owner does not match payer', {
        payment: pay.id, reference: pay.reference,
      });
      return false;
    }
    return (await publishPageById(pay.reference)) !== null;
  } else if (pay.purpose === 'credits' && pay.reference) {
    return (await grantCreditsForPack(pay.user_email, pay.reference)) !== null;
  } else if (pay.purpose === 'plan' && pay.reference) {
    return activatePlan(pay.user_email, pay.reference);
  }
  return false;
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

  // Always log the full raw query on every return — this is the only way to
  // see exactly what SUMIT sent back when verification fails, since we have
  // no direct log access outside this server.
  console.log('[PAYMENT RETURN] query params:', JSON.stringify(req.query));
  const sumitPaymentId = extractSumitPaymentId(req.query as Record<string, unknown>);

  let verified = false;
  let verifyDetail = 'no matching PaymentID param in query';
  if (sumitPaymentId) {
    const p = await getPayment(sumitPaymentId);
    if (!p) {
      verifyDetail = 'SUMIT getPayment lookup failed or returned no payment';
    } else if (!p.valid) {
      verifyDetail = `SUMIT reports ValidPayment=false (status: ${p.status ?? 'unknown'})`;
    } else if (p.amount + 0.001 < pay.amount) {
      verifyDetail = `amount mismatch: SUMIT reports ${p.amount}, expected >= ${pay.amount}`;
    } else if (await sumitPaymentIdAlreadyConsumed(sumitPaymentId, pay.id)) {
      verifyDetail = `SUMIT PaymentID ${sumitPaymentId} was already used to settle another payment row`;
    } else {
      verified = true;
    }
  }

  if (!verified) {
    console.error('[PAYMENT RETURN] verification failed', { ref, sumitPaymentId: sumitPaymentId ?? 'MISSING', reason: verifyDetail, rawQuery: req.query });
    // Never grant on an unconfirmed payment — flag for review instead. An
    // admin can inspect this (GET /api/admin/payments?status=needs_review)
    // and re-verify or force-activate it once the cause is understood —
    // see admin.routes.ts.
    await supabase
      .from('payments')
      .update({ status: 'needs_review', sumit_payment_id: sumitPaymentId ? String(sumitPaymentId) : null })
      .eq('id', ref);
    res.redirect(clientUrl('review'));
    return;
  }

  // Claim the row ATOMICALLY before granting anything. The `pay.status ===
  // 'paid'` early-return above is a read-then-act check: two returns arriving
  // together (double-click on the redirect, a retry, a prefetching browser)
  // could both read 'pending' and both call grantPaymentValue, granting the
  // purchase twice off one charge. This conditional update only matches while
  // the row is still un-granted, so exactly one request wins it.
  const { data: claimed } = await supabase
    .from('payments')
    .update({ status: 'processing', sumit_payment_id: String(sumitPaymentId) })
    .eq('id', ref)
    // 'failed' is claimable too: a user who cancelled once (which marks the row
    // failed) and then completed the payment on SUMIT comes back here with a
    // genuinely verified payment. Verification and the PaymentID-reuse check
    // have already passed at this point, so refusing would strand a real
    // customer in 'review'.
    .in('status', ['pending', 'needs_review', 'failed'])
    .select('id')
    .maybeSingle();

  if (!claimed) {
    // Another request is already handling (or has handled) this payment.
    // Report whatever the authoritative row says rather than granting again.
    const { data: fresh } = await supabase.from('payments').select('status').eq('id', ref).single();
    const freshStatus = (fresh as { status?: string } | null)?.status;
    res.redirect(clientUrl(freshStatus === 'paid' ? 'success' : 'review'));
    return;
  }

  const ok = await grantPaymentValue(pay);

  // 'processing' is deliberately NOT a terminal state: if the process dies
  // between the claim and here, the row stays visible to the admin recovery
  // tool (listReviewPayments includes it) instead of silently disappearing.
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

// ─── Admin: inspect + manually resolve stuck payments ─────────────────────────
// Until now a 'needs_review' payment (verification failed, or grantPaymentValue
// itself failed) had NO recovery path except editing the DB by hand. These
// give an admin (requireAdmin, see admin.routes.ts) a real tool: see what's
// stuck and why, then either re-run verification (if the underlying SUMIT/
// network issue was transient) or, after manually confirming the charge in
// the SUMIT dashboard, force-grant the value without re-verification.

export async function listReviewPayments(req: Request, res: Response): Promise<void> {
  const status = (req.query.status as string) || 'needs_review';
  // A row left at 'processing' is one whose grant was interrupted mid-flight
  // (see paymentReturn). It needs exactly the same admin attention as
  // 'needs_review', so the default view shows both — otherwise it would be
  // invisible to every recovery path.
  const statuses = status === 'needs_review' ? ['needs_review', 'processing'] : [status];
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .in('status', statuses)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
}

export async function reverifyPayment(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { data: payData } = await supabase.from('payments').select('*').eq('id', id).single();
  const pay = payData as PaymentRow | null;
  if (!pay) { res.status(404).json({ error: 'Payment not found' }); return; }
  if (pay.status === 'paid') { res.json({ status: 'paid', note: 'already granted' }); return; }
  if (!pay.sumit_payment_id) {
    res.status(400).json({ error: 'No sumit_payment_id on record — nothing to re-verify against. Use force-activate instead if you have confirmed the charge manually.' });
    return;
  }

  const p = await getPayment(pay.sumit_payment_id);
  if (!p || !p.valid || p.amount + 0.001 < pay.amount) {
    res.status(409).json({ error: 'Still not verifiable', detail: p ?? null });
    return;
  }
  if (await sumitPaymentIdAlreadyConsumed(pay.sumit_payment_id, pay.id)) {
    res.status(409).json({ error: 'This SUMIT PaymentID has already been used to settle another payment. Refusing to grant twice.' });
    return;
  }

  const ok = await grantPaymentValue(pay);
  await supabase
    .from('payments')
    .update({ status: ok ? 'paid' : 'needs_review', paid_at: ok ? new Date().toISOString() : null })
    .eq('id', id);
  res.json({ status: ok ? 'paid' : 'needs_review' });
}

export async function forceActivatePayment(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const adminEmail = req.authEmail;
  const { data: payData } = await supabase.from('payments').select('*').eq('id', id).single();
  const pay = payData as PaymentRow | null;
  if (!pay) { res.status(404).json({ error: 'Payment not found' }); return; }
  if (pay.status === 'paid') { res.json({ status: 'paid', note: 'already granted' }); return; }

  const ok = await grantPaymentValue(pay);
  console.warn('[PAYMENT ADMIN] force-activate', { id, purpose: pay.purpose, user_email: pay.user_email, ok, by: adminEmail });
  await supabase
    .from('payments')
    .update({ status: ok ? 'paid' : 'needs_review', paid_at: ok ? new Date().toISOString() : null })
    .eq('id', id);
  res.json({ status: ok ? 'paid' : 'needs_review' });
}
