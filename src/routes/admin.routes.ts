import { Router } from 'express';
import { getAllLandingPages } from '../controllers/landing.controller';
import { requireAuth, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

// Admin-only: real login + is_admin flag, verified server-side.
router.get('/pages', requireAuth, requireAdmin, getAllLandingPages);

export default router;
