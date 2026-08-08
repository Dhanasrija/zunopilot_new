import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import {
  inviteMember, listTeam, myPermissions, removeMember, updateMember,
} from '../controllers/team.controller.js';

// Team. Reading the roster is `team:read` (everyone) because an agent needs to
// know who to hand a conversation to; changing it is `team:manage` (owner).

const router = Router();
router.use(requireAuth);

router.get('/me/permissions', myPermissions);
router.get('/', requirePermission('team:read'), listTeam);
/*
 * Inviting is rate limited, which it was not before.
 *
 * An invite used to be able to create only a brand-new account. It can now **attach an existing
 * login**, so an unthrottled endpoint is a way to probe which phone numbers have accounts — one
 * outcome for a number that does, another for one that does not. Sixty a day per workspace is far
 * more than a real team ever needs and makes enumeration useless.
 *
 * Keyed on the workspace rather than the IP: the same office shares an address, and the limit is a
 * statement about a workspace's behaviour rather than a network's.
 *
 * Not skipped under `NODE_ENV=test`, unlike the two app-wide limiters — a test that fires sixty
 * invitations is a test worth failing, and the headers are how the suite proves this is mounted.
 */
const inviteLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.tenantId ?? req.ip ?? 'unknown',
  message: {
    success: false,
    message: 'Too many invitations today. Try again tomorrow, or contact support if you need more.',
  },
});

router.post('/', requirePermission('team:manage'), inviteLimiter, inviteMember);
router.patch('/:userId', requirePermission('team:manage'), updateMember);
router.delete('/:userId', requirePermission('team:manage'), removeMember);

export default router;
