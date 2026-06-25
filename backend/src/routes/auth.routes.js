import { Router } from 'express';
import { signup, login, verifyEmail, me } from '../controllers/auth.controller.js';
import { signupValidator, loginValidator, verifyEmailValidator } from '../validators/auth.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/signup', signupValidator, validate, signup);
router.post('/login', loginValidator, validate, login);
router.post('/verify-email', verifyEmailValidator, validate, verifyEmail);
router.get('/me', requireAuth, me);

export default router;
