import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { createRole, deleteRole, listRoles, updateRole } from '../controllers/role.controller.js';

// Roles.
//
// Reading is `team:read` — anyone who can see the team should be able to see what
// the roles mean, or "Manager" is a word with no definition. Changing them is
// `roles:manage`, which is deliberately separate from `team:manage`: adding a
// colleague is a daily task, redefining what a whole role can reach is a change to
// the security model.

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('team:read'), listRoles);
router.post('/', requirePermission('roles:manage'), createRole);
router.patch('/:roleId', requirePermission('roles:manage'), updateRole);
router.delete('/:roleId', requirePermission('roles:manage'), deleteRole);

export default router;
