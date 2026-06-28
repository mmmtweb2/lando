import { randomBytes } from 'crypto';
import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

const SELECT_FIELDS = 'email, affiliate_code, ai_image_credits, earned_coupons, signup_discount, referred_by_code';

function generateAffiliateCode(): string {
  return randomBytes(3).toString('hex').toUpperCase(); // 6 chars e.g. "A3F9C1"
}

export async function authUser(req: Request, res: Response): Promise<void> {
  const { email, ref } = req.body as { email?: string; ref?: string };

  if (!email || !email.includes('@')) {
    res.status(400).json({ error: 'Valid email required' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedRef   = ref ? ref.trim().toUpperCase() : null;

  // Returning user — just send back their profile
  const { data: existing } = await supabase
    .from('user_profiles')
    .select(SELECT_FIELDS)
    .eq('email', normalizedEmail)
    .single();

  if (existing) {
    res.json(existing);
    return;
  }

  // New user — validate referral code if provided
  let validRef: string | null = null;
  if (normalizedRef) {
    const { data: referrer } = await supabase
      .from('user_profiles')
      .select('affiliate_code, earned_coupons')
      .eq('affiliate_code', normalizedRef)
      .single();

    if (referrer) {
      validRef = normalizedRef;
      // Increment referrer's earned_coupons
      await supabase
        .from('user_profiles')
        .update({ earned_coupons: (referrer.earned_coupons ?? 0) + 1 })
        .eq('affiliate_code', normalizedRef);
    }
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .insert({
      email:           normalizedEmail,
      affiliate_code:  generateAffiliateCode(),
      ai_image_credits: 0,
      earned_coupons:  0,
      signup_discount: validRef !== null,
      referred_by_code: validRef,
    })
    .select(SELECT_FIELDS)
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json(data);
}
