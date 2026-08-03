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
router.post('/', requirePermission('team:manage'), inviteMember);
router.patch('/:userId', requirePermission('team:manage'), updateMember);
router.delete('/:userId', requirePermission('team:manage'), removeMember);

export default router;
