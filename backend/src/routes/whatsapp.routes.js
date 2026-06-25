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
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/config', embeddedSignupConfig); // public so frontend can launch FB.login

router.use(requireAuth);
router.get('/', getWhatsappAccount);
router.post('/embedded-signup', requireRole('OWNER', 'MANAGER'), embeddedSignupValidator, validate, completeEmbeddedSignup);
router.patch('/token', requireRole('OWNER', 'MANAGER'), updateAccessToken);
router.delete('/', requireRole('OWNER'), disconnectWhatsapp);

export default router;
