import { Router } from 'express';
import { getAllLandingPages } from '../controllers/landing.controller';
import { listReviewPayments, reverifyPayment, forceActivatePayment } from '../controllers/payment.controller';
import { listCoupons, createCoupon, updateCoupon } from '../controllers/coupon.controller';
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

// Coupons. No DELETE, deliberately: coupon_redemptions and payments reference a
// coupon, so the admin "delete" is PATCH { active: false } — the code stops
// working instantly and the accounting history stays intact.
router.get('/coupons', requireAuth, requireAdmin, listCoupons);
router.post('/coupons', requireAuth, requireAdmin, createCoupon);
router.patch('/coupons/:id', requireAuth, requireAdmin, updateCoupon);

export default router;
