import { Router } from 'express';
import healthRouter from './health.routes';
import landingRouter from './landing.routes';
import adminRouter from './admin.routes';
import userRouter from './user.routes';
import paymentRouter from './payment.routes';
import siteRouter from './site.routes';
import seoRouter from './seo.routes';
import publicAuditRouter from './publicAudit.routes';

const router = Router();

router.use('/health', healthRouter);
router.use('/landing', landingRouter);
router.use('/admin', adminRouter);
router.use('/users', userRouter);
router.use('/payments', paymentRouter);
router.use('/site', siteRouter);
router.use('/seo', seoRouter);
router.use('/public', publicAuditRouter);

export default router;
