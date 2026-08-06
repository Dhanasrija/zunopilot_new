import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  completeProfile, listBusinessCategories, me, requestLoginCode, verifyEmail, verifyLoginCode,
} from '../controllers/auth.controller.js';
import { verifyEmailValidator } from '../validators/auth.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';

// Customer authentication.
//
// Signup and login are one flow: `POST /otp` then `POST /otp/verify`. There is no
// password endpoint — the phone number is the identifier and a one-time code is
// the credential.
//
// Two limiters, because they stop different things. The per-phone hourly cap lives
// in `otp.service.ts` (in the database, since that abuse rotates IPs freely); these
// are the per-IP caps that stop one client hammering the endpoint at all.

const requestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 10_000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many code requests. Try again in a few minutes.' },
});

/**
 * Verification is limited harder than requesting.
 *
 * Requesting a code costs us an SMS; guessing one costs an attacker nothing. The
 * per-challenge attempt counter is the real defence, but this stops someone
 * cycling fresh challenges to get a new allowance of guesses each time.
 */
const verifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 10_000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Try again in a few minutes.' },
});

const router = Router();

router.post('/otp', requestLimiter, requestLoginCode);
router.post('/otp/verify', verifyLimiter, verifyLoginCode);

// Needed by the profile form before there is any session, and by the form after.
router.get('/business-categories', listBusinessCategories);

router.get('/me', requireAuth, me);
router.put('/profile', requireAuth, completeProfile);

router.post('/verify-email', verifyEmailValidator, validate, verifyEmail);

export default router;
