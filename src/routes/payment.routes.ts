import { Router } from 'express';
import { startPayment, paymentReturn, validateCoupon } from '../controllers/payment.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

const startLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'יותר מדי ניסיונות תשלום. נסו שוב מאוחר יותר.',
});

// Start a payment (authenticated) → returns a SUMIT redirect URL.
router.post('/start', requireAuth, startLimiter, startPayment);

// Live coupon preview (authenticated, read-only — no redemption is consumed
// here; startPayment re-validates and is the only thing that counts a use).
// Rate-limited on the same bucket shape as /start so the endpoint can't be used
// to brute-force guessable promo codes.
router.post('/validate-coupon', requireAuth, rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: 'יותר מדי ניסיונות קופון. נסו שוב מאוחר יותר.',
}), validateCoupon);

// SUMIT redirects the browser back here (public — identity comes from the
// stored payment row + server-side verification, not from the request).
router.get('/return', paymentReturn);

export default router;
