import { Router } from 'express';
import { getAllLandingPages } from '../controllers/landing.controller';

const router = Router();

router.get('/pages', getAllLandingPages);

export default router;
