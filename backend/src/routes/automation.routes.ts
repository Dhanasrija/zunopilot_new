import { Router } from 'express';
import {
  listKeywordRules,
  createKeywordRule,
  updateKeywordRule,
  deleteKeywordRule,
  getFallback,
  updateFallback,
} from '../controllers/automation.controller.js';
import { upsertKeywordValidator, fallbackValidator } from '../validators/automation.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/keywords', requirePermission('automation:write'), listKeywordRules);
router.post('/keywords', requirePermission('automation:write'), upsertKeywordValidator, validate, createKeywordRule);
router.patch('/keywords/:id', requirePermission('automation:write'), upsertKeywordValidator, validate, updateKeywordRule);
router.delete('/keywords/:id', requirePermission('automation:write'), deleteKeywordRule);

router.get('/fallback', requirePermission('automation:write'), getFallback);
router.put('/fallback', requirePermission('automation:write'), fallbackValidator, validate, updateFallback);

export default router;
