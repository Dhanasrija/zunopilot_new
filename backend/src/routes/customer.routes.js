import { Router } from 'express';
import { listCustomers, getCustomer, getCustomerMessages } from '../controllers/customer.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', listCustomers);
router.get('/:id', getCustomer);
router.get('/:id/messages', getCustomerMessages);

export default router;
