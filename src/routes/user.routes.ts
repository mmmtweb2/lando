import { Router } from 'express';
import { authUser } from '../controllers/user.controller';

const router = Router();

router.post('/auth', authUser);

export default router;
