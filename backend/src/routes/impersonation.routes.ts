import { Router } from 'express';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import * as impersonation from '../controllers/impersonation.controller.js';

// The workspace's own view of support access.
//
// Reading is `settings:read` — every member should be able to see that someone
// outside the business looked at their customers. Deciding is
// `impersonation:manage`, which is OWNER only and deliberately separate from
// `settings:write`: consenting to that is not the same kind of decision as
// changing a setting, and must not come along with one.

export const impersonationRoutes = Router();
impersonationRoutes.use(requireAuth);

impersonationRoutes.get('/', requirePermission('settings:read'), impersonation.listSupportAccess);
impersonationRoutes.get('/:grantId/log', requirePermission('settings:read'), impersonation.supportAccessLog);

impersonationRoutes.post('/:grantId/approve', requirePermission('impersonation:manage'), impersonation.approveSupportAccess);
impersonationRoutes.post('/:grantId/deny', requirePermission('impersonation:manage'), impersonation.denySupportAccess);
impersonationRoutes.post('/:grantId/revoke', requirePermission('impersonation:manage'), impersonation.revokeSupportAccess);
