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
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/keywords', listKeywordRules);
router.post('/keywords', requireRole('OWNER', 'MANAGER'), upsertKeywordValidator, validate, createKeywordRule);
router.patch('/keywords/:id', requireRole('OWNER', 'MANAGER'), upsertKeywordValidator, validate, updateKeywordRule);
router.delete('/keywords/:id', requireRole('OWNER', 'MANAGER'), deleteKeywordRule);

router.get('/fallback', getFallback);
router.put('/fallback', requireRole('OWNER', 'MANAGER'), fallbackValidator, validate, updateFallback);

export default router;
