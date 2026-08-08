import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  completeProfile, listBusinessCategories, me, requestLoginCode, verifyEmail, verifyLoginCode,
  listWorkspaces,
  switchWorkspace,
} from '../controllers/auth.controller.js';
import { verifyEmailValidator } from '../validators/auth.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireSession } from '../middleware/auth.js';

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

/*
 * Switching mints a token, so it is rate-limited like the other credential-issuing routes here.
 * Generous enough that a person moving between their own workspaces never notices.
 */
const switchLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many workspace switches. Try again in a few minutes.' },
});

const router = Router();

router.post('/otp', requestLimiter, requestLoginCode);
router.post('/otp/verify', verifyLimiter, verifyLoginCode);

// Needed by the profile form before there is any session, and by the form after.
router.get('/business-categories', listBusinessCategories);

router.get('/me', requireAuth, me);
router.put('/profile', requireAuth, completeProfile);

/*
 * The workspace switcher, on `requireSession` rather than `requireAuth`.
 *
 * **Deliberate, and the reason `requireSession` exists.** `requireAuth` refuses a session whose
 * workspace has been suspended, and refuses a legacy token belonging to somebody with more than one
 * workspace. Behind it, either state would be a dead end: the person could not see their other
 * workspaces and could not move to one, so the only exit would be a support ticket.
 *
 * `switchLimiter` because a switch mints a token, and an unthrottled mint endpoint is a token
 * factory.
 */
router.get('/workspaces', requireSession, listWorkspaces);
router.post('/workspaces/switch', switchLimiter, requireSession, switchWorkspace);

router.post('/verify-email', verifyEmailValidator, validate, verifyEmail);

export default router;
