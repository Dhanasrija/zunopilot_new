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
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/meta', requirePermission('templates:write'), listMetaTemplates);
router.get('/meta/:id', requirePermission('templates:write'), getMetaTemplate);
router.post('/meta', requirePermission('templates:write'), createMetaTemplate);
router.post('/meta/:id', requirePermission('templates:write'), updateMetaTemplate);
router.delete('/meta/:name', requirePermission('templates:delete'), deleteMetaTemplate);

router.get('/', requirePermission('templates:write'), listTemplates);
router.put('/', requirePermission('templates:write'), templateValidator, validate, upsertTemplate);
router.delete('/:id', requirePermission('templates:delete'), deleteTemplate);

export default router;
