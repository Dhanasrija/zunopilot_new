import { Router } from 'express';
import { overview, ordersByDay, ordersByStatus, messageStats, recentOrders } from '../controllers/analytics.controller.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

// Analytics.
//
// `analytics:read` existed in the permission vocabulary but nothing enforced it —
// every route here was open to any authenticated member. Harmless while the three
// fixed roles all happened to include it, and wrong the moment a workspace can
// build a role that deliberately excludes it.

const router = Router();
router.use(requireAuth);
router.use(requirePermission('analytics:read'));

router.get('/overview',        overview);
router.get('/orders-by-day',   ordersByDay);
router.get('/orders-by-status', ordersByStatus);
router.get('/message-stats',   messageStats);
router.get('/recent-orders',   recentOrders);

export default router;
