import { Router } from 'express';
import {
  listTemplates,
  upsertTemplate,
  deleteTemplate,
  listMetaTemplates,
  getMetaTemplate,
  createMetaTemplate,
  deleteMetaTemplate,
  updateMetaTemplate
} from '../controllers/template.controller.js';
import { templateValidator } from '../validators/template.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/meta', listMetaTemplates);
router.get('/meta/:id', getMetaTemplate);
router.post('/meta', requireRole('OWNER', 'MANAGER'), createMetaTemplate);
router.post('/meta/:id', requireRole('OWNER', 'MANAGER'), updateMetaTemplate);
router.delete('/meta/:name', requireRole('OWNER'), deleteMetaTemplate);

router.get('/', listTemplates);
router.put('/', requireRole('OWNER', 'MANAGER'), templateValidator, validate, upsertTemplate);
router.delete('/:id', requireRole('OWNER'), deleteTemplate);

export default router;
