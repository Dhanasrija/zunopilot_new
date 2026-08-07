import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import {
  createKnowledge, deleteKnowledge, listKnowledge, tryKnowledge, updateKnowledge,
} from './knowledge.controller.js';

// What the business has told its assistant about itself.
//
// **`automation:write`, the permission that already governs what the assistant says.** It
// covers the keyword rules and the fallback message, and this is the same decision made in
// prose. Minting a new permission key would also have been quietly useless: `Role.permissions`
// is a snapshot taken when a workspace is created, so a new key is held by nobody and the page
// would 403 for every existing customer including the owner.
//
// **No `requireModule`.** `AI_AGENT` decides whether a model is ever called; it does not decide
// whether a business may write down what it does. Someone whose agent is currently off should
// still be able to prepare the knowledge — that is the natural order to work in, and the try-it
// endpoint refuses on its own with a message that says which switch is the problem.

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('automation:write'), listKnowledge);
router.post('/', requirePermission('automation:write'), createKnowledge);

// A real model call against real knowledge. Same permission: it spends the workspace's own
// AI allowance and reveals nothing a reader of the page cannot already see. Above `/:id`,
// per the convention here — a literal path that sits below a parameter route is a bug
// waiting for somebody to add the matching verb.
router.post('/try', requirePermission('automation:write'), tryKnowledge);
router.patch('/:id', requirePermission('automation:write'), updateKnowledge);
router.delete('/:id', requirePermission('automation:write'), deleteKnowledge);


export default router;
