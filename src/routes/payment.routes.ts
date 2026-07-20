import { Router } from 'express';
import { startPayment, paymentReturn } from '../controllers/payment.controller';
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

// SUMIT redirects the browser back here (public — identity comes from the
// stored payment row + server-side verification, not from the request).
router.get('/return', paymentReturn);

export default router;
