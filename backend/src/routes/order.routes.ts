import { Router } from 'express';
import {
  createOrder, listOrders, getOrderSummary, getOrder, updateOrderStatus,
} from '../controllers/order.controller.js';
import { createOrderValidator, updateStatusValidator } from '../validators/order.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireModule, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

/*
 * Selling is a module, so a workspace that does not sell cannot reach this at all.
 *
 * Mounted here rather than relying on the nav hiding the screen: a hidden menu item is a
 * hint, not a control, and a typed URL or a stale bookmark would otherwise still work.
 * Refuses with 404 rather than 403 — the same reasoning as every other module gate.
 */
router.use(requireModule('ECOMMERCE'));

// `orders:write` was in the vocabulary but nothing enforced it, so every member
// could create an order and move its status. The seeded Agent role holds it —
// advancing an order while on the phone to the customer is the job — but a
// workspace can now build a role that cannot.
router.get('/', requirePermission('orders:read'), listOrders);
router.post('/', requirePermission('orders:write'), createOrderValidator, validate, createOrder);
// Ahead of `/:id`, or Express matches "summary" as an order id and returns a 404 for a
// route that exists.
router.get('/summary', requirePermission('orders:read'), getOrderSummary);
router.get('/:id', requirePermission('orders:read'), getOrder);
router.patch('/:id/status', requirePermission('orders:write'), updateStatusValidator, validate, updateOrderStatus);

export default router;
