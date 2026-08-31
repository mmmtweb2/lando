import { Router } from 'express';
import { authUser, purchaseCredits, getCredits, getPlan } from '../controllers/user.controller';
import { rateLimit } from '../middleware/rateLimit';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

// Payment/checkout endpoint — cap attempts per client.
const purchaseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  message: 'יותר מדי ניסיונות רכישה. נסו שוב מאוחר יותר.',
});

router.post('/auth', requireAuth, authUser);
router.get('/credits', requireAuth, getCredits);
router.get('/plan', requireAuth, getPlan);
router.post('/credits/purchase', purchaseLimiter, requireAuth, purchaseCredits);

export default router;
