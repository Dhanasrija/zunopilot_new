import { Router } from 'express';
import { overview, ordersByDay, ordersByStatus, messageStats, recentOrders } from '../controllers/analytics.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/overview',        overview);
router.get('/orders-by-day',   ordersByDay);
router.get('/orders-by-status', ordersByStatus);
router.get('/message-stats',   messageStats);
router.get('/recent-orders',   recentOrders);

export default router;
