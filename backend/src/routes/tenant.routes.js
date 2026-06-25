import { Router } from 'express';
import { getProfile, updateProfile, listStaff } from '../controllers/tenant.controller.js';
import { updateTenantValidator } from '../validators/tenant.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/me', getProfile);
router.patch('/me', requireRole('OWNER', 'MANAGER'), updateTenantValidator, validate, updateProfile);
router.get('/staff', listStaff);

export default router;
