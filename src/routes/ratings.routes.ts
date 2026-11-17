import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { rateLimit } from '../middleware/rateLimit';
import { dismiss, mine, publicList, saveRating } from '../controllers/ratings.controller';

// Customer ratings (migration 052). The admin side lives in admin.routes.ts behind the admin gate.
const router = Router();
const mineLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 60 });

router.get('/public', publicLimiter, publicList);
router.get('/mine', mineLimiter, requireAuth, mine);
router.post('/mine', mineLimiter, requireAuth, saveRating);
router.post('/mine/dismiss', mineLimiter, requireAuth, dismiss);

export default router;
