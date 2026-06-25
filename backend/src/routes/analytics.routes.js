import { Router } from 'express';
import { overview, ordersByDay } from '../controllers/analytics.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/overview', overview);
router.get('/orders-by-day', ordersByDay);

export default router;
