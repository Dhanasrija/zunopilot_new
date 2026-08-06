import { Router } from 'express';
import { getProfile, updateProfile, listStaff } from '../controllers/tenant.controller.js';
import { updateTenantValidator } from '../validators/tenant.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/me', requirePermission('settings:read'), getProfile);
router.patch('/me', requirePermission('settings:write'), updateTenantValidator, validate, updateProfile);
router.get('/staff', requirePermission('team:read'), listStaff);

export default router;
