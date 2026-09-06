// ─────────────────────────────────────────────────────────────────────────────
// Admin coupon management — /api/admin/coupons
//
// Everything here is behind requireAdminPanelPassword + requireAuth +
// requireAdmin (see routes/admin.routes.ts). The customer-facing half of the
// feature lives in payment.controller.ts / coupon.service.ts.
//
// Two rules this file exists to enforce, on top of the plain CRUD:
//   • `redemptions_count` is SYSTEM-OWNED. It is the compare-and-swap counter
//     that makes max_redemptions airtight; letting an admin write it by hand
//     would let a typo hand out unlimited discounts (or silently exhaust a live
//     promo). It is not editable through any endpoint here.
//   • There is NO DELETE. `coupon_redemptions` and `payments` reference a
//     coupon, and a coupon that priced a real payment is part of that payment's
//     accounting record. `active = false` is the "delete" the admin UI exposes:
//     it stops the code working instantly and keeps the history intact.
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { COUPON_PURPOSES, isCouponPurpose, normalizeCode } from '../services/coupon.service';

/** Conservative on purpose: a coupon code is typed by hand, read off a poster,
 *  and pasted into a URL, so anything that survives a copy/paste badly (spaces,
 *  RTL text, punctuation) is rejected at creation rather than debugged later. */
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

interface CouponInput {
  code?: string;
  discount_type?: string;
  discount_value?: number | string;
  applicable_purposes?: string[] | null;
  max_redemptions?: number | string | null;
  max_per_user?: number | string | null;
  expires_at?: string | null;
  notes?: string | null;
  active?: boolean;
}

/** Parses an optional positive-integer field. Returns `undefined` when the
 *  value is not usable, which callers turn into a 400. */
function optionalPositiveInt(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === '') return null; // = unlimited
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

function validatePurposes(value: unknown): string[] | null | undefined {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return undefined;
  const cleaned = value.filter((p) => typeof p === 'string' && p.trim());
  if (cleaned.length === 0) return null;           // empty = "any purpose"
  if (!cleaned.every(isCouponPurpose)) return undefined;
  return Array.from(new Set(cleaned));
}

// ─── GET /api/admin/coupons ──────────────────────────────────────────────────
export async function listCoupons(_req: Request, res: Response): Promise<void> {
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
}

// ─── POST /api/admin/coupons ─────────────────────────────────────────────────
export async function createCoupon(req: Request, res: Response): Promise<void> {
  const body = req.body as CouponInput;

  const code = normalizeCode(body.code ?? '');
  if (!CODE_PATTERN.test(code)) {
    res.status(400).json({ error: 'קוד לא תקין. אותיות באנגלית, ספרות, מקף או קו תחתון בלבד (2–32 תווים).' });
    return;
  }

  const discountType = body.discount_type;
  if (discountType !== 'percent' && discountType !== 'fixed') {
    res.status(400).json({ error: "discount_type חייב להיות 'percent' או 'fixed'." });
    return;
  }

  const discountValue = Number(body.discount_value);
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    res.status(400).json({ error: 'ערך ההנחה חייב להיות מספר חיובי.' });
    return;
  }
  // A percent above 100 is always a typo (someone meant ₪), and it would price
  // every purchase down to the 1₪ floor.
  if (discountType === 'percent' && discountValue > 100) {
    res.status(400).json({ error: 'הנחה באחוזים חייבת להיות בין 1 ל־100.' });
    return;
  }

  const purposes = validatePurposes(body.applicable_purposes);
  if (purposes === undefined) {
    res.status(400).json({ error: `applicable_purposes חייב להכיל רק: ${COUPON_PURPOSES.join(', ')}` });
    return;
  }

  const maxRedemptions = optionalPositiveInt(body.max_redemptions);
  if (maxRedemptions === undefined) { res.status(400).json({ error: 'מספר שימושים מרבי חייב להיות מספר שלם חיובי.' }); return; }

  // DEFAULT 1, deliberately: an admin who omits this almost always means "one
  // per customer", and the uncapped reading is the one that costs money. An
  // explicit unlimited is still possible — send the key with null/"" — so the
  // default only applies when the field was not mentioned at all.
  let maxPerUser: number | null = 1;
  if (Object.prototype.hasOwnProperty.call(body, 'max_per_user')) {
    const parsed = optionalPositiveInt(body.max_per_user);
    if (parsed === undefined) { res.status(400).json({ error: 'מגבלה למשתמש חייבת להיות מספר שלם חיובי.' }); return; }
    maxPerUser = parsed;
  }

  let expiresAt: string | null = null;
  if (body.expires_at) {
    const d = new Date(body.expires_at);
    if (Number.isNaN(d.getTime())) { res.status(400).json({ error: 'תאריך תפוגה לא תקין.' }); return; }
    expiresAt = d.toISOString();
  }

  const { data, error } = await supabase
    .from('coupons')
    .insert({
      code,
      discount_type: discountType,
      discount_value: discountValue,
      applicable_purposes: purposes,
      max_redemptions: maxRedemptions,
      max_per_user: maxPerUser,
      expires_at: expiresAt,
      notes: body.notes ?? null,
      active: body.active === false ? false : true,
      created_by: req.authEmail ?? null,
    })
    .select('*')
    .single();

  if (error) {
    // 23505 = unique violation on `code`. A duplicate is an ordinary admin
    // mistake, not a server error, so it gets a 409 and a readable message.
    if (error.code === '23505') { res.status(409).json({ error: 'קוד קופון זה כבר קיים.' }); return; }
    res.status(500).json({ error: error.message });
    return;
  }
  res.status(201).json(data);
}

// ─── PATCH /api/admin/coupons/:id ────────────────────────────────────────────
/**
 * Edits the rules of an existing coupon. The code itself is immutable: it has
 * already been printed/sent to customers, and `coupon_redemptions` rows are
 * only readable as "what this code did" if the code stays what it was.
 * `redemptions_count` is never accepted here — see the file header.
 */
export async function updateCoupon(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const body = req.body as CouponInput;
  const patch: Record<string, unknown> = {};

  if (typeof body.active === 'boolean') patch.active = body.active;

  if (Object.prototype.hasOwnProperty.call(body, 'expires_at')) {
    if (!body.expires_at) {
      patch.expires_at = null;
    } else {
      const d = new Date(body.expires_at);
      if (Number.isNaN(d.getTime())) { res.status(400).json({ error: 'תאריך תפוגה לא תקין.' }); return; }
      patch.expires_at = d.toISOString();
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'max_redemptions')) {
    const parsed = optionalPositiveInt(body.max_redemptions);
    if (parsed === undefined) { res.status(400).json({ error: 'מספר שימושים מרבי חייב להיות מספר שלם חיובי.' }); return; }
    patch.max_redemptions = parsed;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'max_per_user')) {
    const parsed = optionalPositiveInt(body.max_per_user);
    if (parsed === undefined) { res.status(400).json({ error: 'מגבלה למשתמש חייבת להיות מספר שלם חיובי.' }); return; }
    patch.max_per_user = parsed;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'applicable_purposes')) {
    const purposes = validatePurposes(body.applicable_purposes);
    if (purposes === undefined) {
      res.status(400).json({ error: `applicable_purposes חייב להכיל רק: ${COUPON_PURPOSES.join(', ')}` });
      return;
    }
    patch.applicable_purposes = purposes;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'notes')) patch.notes = body.notes ?? null;

  // Discount shape can be corrected after creation (a promo mistyped as 10₪
  // instead of 10%). It only ever affects FUTURE redemptions — payments already
  // opened carry their own discount_amount.
  if (Object.prototype.hasOwnProperty.call(body, 'discount_type') || Object.prototype.hasOwnProperty.call(body, 'discount_value')) {
    const type = body.discount_type;
    if (type !== 'percent' && type !== 'fixed') {
      res.status(400).json({ error: "discount_type חייב להיות 'percent' או 'fixed'." });
      return;
    }
    const value = Number(body.discount_value);
    if (!Number.isFinite(value) || value <= 0 || (type === 'percent' && value > 100)) {
      res.status(400).json({ error: 'ערך ההנחה אינו תקין.' });
      return;
    }
    patch.discount_type = type;
    patch.discount_value = value;
  }

  if (Object.keys(patch).length === 0) { res.status(400).json({ error: 'אין שדות לעדכון.' }); return; }

  const { data, error } = await supabase
    .from('coupons')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(404).json({ error: 'הקופון לא נמצא.' }); return; }
  res.json(data);
}
