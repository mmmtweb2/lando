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
// Rate-limited per IP: every hit costs a DB read and, with a PaymentID, a server-to-server call to
// SUMIT, and an attacker could otherwise probe PaymentIDs/refs at will. A real customer returns from
// SUMIT once or twice, so 30 per 10 minutes leaves ample room for retries and double-clicks.
const returnLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'יותר מדי בקשות. נסו שוב בעוד כמה דקות.',
});
router.get('/return', returnLimiter, paymentReturn);

export default router;
