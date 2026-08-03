import { Router } from 'express';
import {
  completeEmbeddedSignup,
  getWhatsappAccount,
  disconnectWhatsapp,
  embeddedSignupConfig,
  updateAccessToken,
} from '../controllers/whatsapp.controller.js';
import { embeddedSignupValidator } from '../validators/whatsapp.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();

router.get('/config', embeddedSignupConfig); // public so frontend can launch FB.login

router.use(requireAuth);
router.get('/', requirePermission('settings:read'), getWhatsappAccount);
router.post('/embedded-signup', requirePermission('channel:manage'), embeddedSignupValidator, validate, completeEmbeddedSignup);
router.patch('/token', requirePermission('channel:manage'), updateAccessToken);
router.delete('/', requirePermission('channel:disconnect'), disconnectWhatsapp);

export default router;
