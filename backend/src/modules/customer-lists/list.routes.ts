import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import {
  deleteListHandler, deleteListMembers, getList, getListMembers, getLists, patchList,
  postList, postListMembers,
} from './list.controller.js';

// Curated customer lists.
//
// **No `requireModule` here, deliberately.** Leads, Support and Marketing are gated
// because an operator sells them; organising your own customers is not a product tier. So
// these ride on the `customers:read` / `customers:write` permissions that already exist,
// which also means a workspace whose Marketing module is off can still build the lists it
// will use the day it is switched on.
//
// Membership changes are `customers:write` rather than a new permission: someone who can
// edit a customer can already do more than move them between lists.

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('customers:read'), getLists);
router.post('/', requirePermission('customers:write'), postList);

// Ahead of `/:id`, so "members" is never mistaken for a list id.
router.get('/:id/members', requirePermission('customers:read'), getListMembers);
router.post('/:id/members', requirePermission('customers:write'), postListMembers);
router.delete('/:id/members', requirePermission('customers:write'), deleteListMembers);

router.get('/:id', requirePermission('customers:read'), getList);
router.patch('/:id', requirePermission('customers:write'), patchList);
router.delete('/:id', requirePermission('customers:write'), deleteListHandler);

export default router;
