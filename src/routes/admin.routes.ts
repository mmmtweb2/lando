import { Router } from 'express';
import { getAllLandingPages } from '../controllers/landing.controller';
import { listReviewPayments, reverifyPayment, forceActivatePayment } from '../controllers/payment.controller';
import { requireAuth, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

// Admin-only: real login + is_admin flag, verified server-side.
router.get('/pages', requireAuth, requireAdmin, getAllLandingPages);

// Stuck-payment recovery (see payment.controller.ts's grantPaymentValue for
// context — these give an admin a way to inspect and resolve a payment stuck
// at 'needs_review' instead of needing to edit the DB by hand).
router.get('/payments', requireAuth, requireAdmin, listReviewPayments);
router.post('/payments/:id/reverify', requireAuth, requireAdmin, reverifyPayment);
router.post('/payments/:id/force-activate', requireAuth, requireAdmin, forceActivatePayment);

export default router;
