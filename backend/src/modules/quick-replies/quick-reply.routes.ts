import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import {
  deleteQuickReplyHandler, getQuickReplies, getQuickReply, patchQuickReply, postQuickReply,
} from './quick-reply.controller.js';

// Saved reply-button sets an agent can send from the Inbox.
//
// **Two permissions, and the split is the point.** Reading is `inbox:reply`, because an agent has
// to see the sets to send one. Writing is `automation:write` — the permission that already guards
// keyword rules — because a button can be bound to a workflow, and choosing what a customer's tap
// starts is configuring the automation, not answering a message. Every agent may use them; not
// every agent may decide what they do.
//
// **No `requireModule`.** Leads, Support and Marketing are gated because an operator sells them.
// Asking a customer a question with two answers is not a product tier, and gating it would mean the
// cheapest plan's agents type "reply 1 for delivery, 2 for pickup" instead.

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('inbox:reply'), getQuickReplies);
router.post('/', requirePermission('automation:write'), postQuickReply);

router.get('/:id', requirePermission('inbox:reply'), getQuickReply);
router.patch('/:id', requirePermission('automation:write'), patchQuickReply);
router.delete('/:id', requirePermission('automation:write'), deleteQuickReplyHandler);

export default router;
