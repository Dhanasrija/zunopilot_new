import { Router } from 'express';
import { createOrder, listOrders, getOrder, updateOrderStatus } from '../controllers/order.controller.js';
import { createOrderValidator, updateStatusValidator } from '../validators/order.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', listOrders);
router.post('/', createOrderValidator, validate, createOrder);
router.get('/:id', getOrder);
router.patch('/:id/status', updateStatusValidator, validate, updateOrderStatus);

export default router;
