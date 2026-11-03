import { Router } from 'express';
import { getAllLandingPages } from '../controllers/landing.controller';
import { listReviewPayments, reverifyPayment, forceActivatePayment } from '../controllers/payment.controller';
import { listCoupons, createCoupon, updateCoupon } from '../controllers/coupon.controller';
import { listUsers, getRevenueStats, getSiteTraffic, getFunnelStats } from '../controllers/adminStats.controller';
import { adminAuditLeadHandled, adminAuditLeads } from '../controllers/publicAudit.controller';
import { adminGbpConfig } from '../controllers/gbpConfig.controller';
import { adminListGrants, adminGrant, adminRevoke } from '../controllers/betaAccess.controller';
import { adminListFeedback, adminMarkSeen } from '../controllers/feedback.controller';
import { adminSeoOverview, adminSeoFunnel, adminSeoUsers, adminSeoRevenue, adminSeoHealth, adminSeoFeedback, adminSetManualPremium } from '../controllers/adminSeo.controller';
import { adminPreview, adminTest } from '../controllers/digest.controller';
import { requireAuth, requireAdmin } from '../middleware/auth.middleware';
import { requireAdminPanelPassword } from '../middleware/adminPassword.middleware';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

// Everything under /api/admin/* passes, in this order, for EVERY route below:
//   1. a per-IP rate limit (cheap, in memory) — now that the password check no longer sits in
//      front of the identity lookups, this is what stops a scanner from making us do Supabase
//      round-trips for free;
//   2. requireAuth + requireAdmin — a genuine Supabase session whose user_profiles.is_admin is true;
//   3. the shared-secret admin-panel password (x-admin-password).
// The password used to be checked FIRST (it is a cheap string compare). It is now checked LAST on
// purpose: guessing it requires an already-authenticated admin session, and only such a session
// is ever told whether the password was right. Because the three run once here, the routes below
// no longer repeat requireAuth/requireAdmin (that doubled the Supabase calls per request).
router.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120, // the dashboard fires ~10 calls on load; this leaves a lot of headroom for a human
  message: 'יותר מדי בקשות לאזור הניהול. נסו שוב בעוד דקה.',
}));
router.use(requireAuth, requireAdmin, requireAdminPanelPassword);

// Admin-only: real login + is_admin flag, verified server-side.
router.get('/pages', getAllLandingPages);

// Customer list + revenue overview (admin dashboard upgrade).
router.get('/users', listUsers);
router.get('/revenue', getRevenueStats);
router.get('/site-traffic', getSiteTraffic);
router.get('/funnel', getFunnelStats);
// Leads from the public Audit page (task #1, migration 031).
router.get('/audit-leads', adminAuditLeads);
router.post('/audit-leads/:id/handled', adminAuditLeadHandled);
router.get('/gbp-config', adminGbpConfig);
// Free access to the Google-promotion product for testers (manual grants).
router.get('/beta-access', adminListGrants);
router.post('/beta-access', adminGrant);
router.post('/beta-access/revoke', adminRevoke);
// Monthly summary email: preview an account's email, or send a test to yourself.
router.get('/digest/preview', adminPreview);
router.post('/digest/test', adminTest);
// Feedback from testers (migration 034).
router.get('/feedback', adminListFeedback);
router.post('/feedback/:id/seen', adminMarkSeen);

// Admin tabs of the Google-promotion product (task #10, migration 040).
router.get('/seo/overview', adminSeoOverview);
router.get('/seo/funnel', adminSeoFunnel);
router.get('/seo/users', adminSeoUsers);
router.get('/seo/revenue', adminSeoRevenue);
router.get('/seo/health', adminSeoHealth);
router.get('/seo/feedback', adminSeoFeedback);
router.put('/seo/manual-premium', adminSetManualPremium);

// Stuck-payment recovery (see payment.controller.ts's grantPaymentValue for
// context — these give an admin a way to inspect and resolve a payment stuck
// at 'needs_review' instead of needing to edit the DB by hand).
router.get('/payments', listReviewPayments);
router.post('/payments/:id/reverify', reverifyPayment);
router.post('/payments/:id/force-activate', forceActivatePayment);

// Coupons. No DELETE, deliberately: coupon_redemptions and payments reference a
// coupon, so the admin "delete" is PATCH { active: false } — the code stops
// working instantly and the accounting history stays intact.
router.get('/coupons', listCoupons);
router.post('/coupons', createCoupon);
router.patch('/coupons/:id', updateCoupon);

export default router;
