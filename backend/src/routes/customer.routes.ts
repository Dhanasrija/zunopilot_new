import { Router } from 'express';
import {
  listCustomers,
  getCustomer,
  getCustomerMessages,
  createCustomer,
  updateCustomer,
  listCustomerTags,
} from '../controllers/customer.controller.js';
import { createCustomerValidator, updateCustomerValidator } from '../validators/customer.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('customers:read'), listCustomers);

// Gated on `customers:write`, which the seeded Agent role holds.
//
// This used to be ungated, with a comment explaining that agents legitimately
// correct a customer's name or number while handling their conversation. That
// intent is preserved — the Agent role grants it — but it is now the workspace's
// decision rather than ours, which is the whole point of custom roles.
router.post('/', requirePermission('customers:write'), createCustomerValidator, validate, createCustomer);
// Ahead of `/:id`, or Express reads "tags" as a customer id.
router.get('/tags', requirePermission('customers:read'), listCustomerTags);
router.get('/:id', requirePermission('customers:read'), getCustomer);
router.patch('/:id', requirePermission('customers:write'), updateCustomerValidator, validate, updateCustomer);
router.get('/:id/messages', requirePermission('customers:read'), getCustomerMessages);

export default router;
