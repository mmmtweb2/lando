import { Router } from 'express';
import healthRouter from './health.routes';
import landingRouter from './landing.routes';
import adminRouter from './admin.routes';
import userRouter from './user.routes';

const router = Router();

router.use('/health', healthRouter);
router.use('/landing', landingRouter);
router.use('/admin', adminRouter);
router.use('/users', userRouter);

export default router;
