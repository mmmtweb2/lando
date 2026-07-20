import { Router } from 'express';
import healthRouter from './health.routes';
import landingRouter from './landing.routes';
import adminRouter from './admin.routes';
import userRouter from './user.routes';
import paymentRouter from './payment.routes';

const router = Router();

router.use('/health', healthRouter);
router.use('/landing', landingRouter);
router.use('/admin', adminRouter);
router.use('/users', userRouter);
router.use('/payments', paymentRouter);

export default router;
