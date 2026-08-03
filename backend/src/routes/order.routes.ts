import { Router } from 'express';
import { createOrder, listOrders, getOrder, updateOrderStatus } from '../controllers/order.controller.js';
import { createOrderValidator, updateStatusValidator } from '../validators/order.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// `orders:write` was in the vocabulary but nothing enforced it, so every member
// could create an order and move its status. The seeded Agent role holds it —
// advancing an order while on the phone to the customer is the job — but a
// workspace can now build a role that cannot.
router.get('/', requirePermission('orders:read'), listOrders);
router.post('/', requirePermission('orders:write'), createOrderValidator, validate, createOrder);
router.get('/:id', requirePermission('orders:read'), getOrder);
router.patch('/:id/status', requirePermission('orders:write'), updateStatusValidator, validate, updateOrderStatus);

export default router;
