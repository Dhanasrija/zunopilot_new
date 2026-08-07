import { Router } from 'express';
import {
  listConversations,
  getConversation,
  listMessages,
  markRead,
  assignAgent,
  setAutomation,
  sendAgentMessage,
  sendAgentMedia,
  addNote,
  startConversation,
} from '../controllers/inbox.controller.js';
import {
  sendMessageValidator,
  sendMediaValidator,
  assignAgentValidator,
  setAutomationValidator,
  noteValidator,
} from '../validators/inbox.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

// Every route is gated on a named capability. Before this the inbox had no
// role checks at all — any member could reply, reassign and switch automation
// off, which is not a policy so much as the absence of one.

const router = Router();
router.use(requireAuth);
router.use(requirePermission('inbox:read'));

router.get('/conversations', requirePermission('inbox:read'), listConversations);
router.post('/conversations', requirePermission('inbox:reply'), startConversation);
router.get('/conversations/:id', requirePermission('inbox:read'), getConversation);
router.get('/conversations/:id/messages', requirePermission('inbox:read'), listMessages);
router.post('/conversations/:id/messages', requirePermission('inbox:reply'), sendMessageValidator, validate, sendAgentMessage);
// Sending a file is replying, so it needs no permission of its own — an agent who can send
// words can send a photograph. The file itself was uploaded through `POST /api/media`, which
// has its own `media:write` gate.
router.post('/conversations/:id/media', requirePermission('inbox:reply'), sendMediaValidator, validate, sendAgentMedia);
router.post('/conversations/:id/read', markRead);
// `assign_self` is the floor; taking one off a colleague is checked in the
// controller, which is the only place that knows who currently owns it.
router.post('/conversations/:id/assign', requirePermission('inbox:assign_self'), assignAgentValidator, validate, assignAgent);
router.post('/conversations/:id/automation', requirePermission('inbox:toggle_automation'), setAutomationValidator, validate, setAutomation);
router.post('/conversations/:id/notes', requirePermission('inbox:add_note'), noteValidator, validate, addNote);

export default router;
