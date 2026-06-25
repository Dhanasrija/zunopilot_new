import { Router } from 'express';
import {
  listConversations,
  getConversation,
  listMessages,
  markRead,
  assignAgent,
  setAutomation,
  sendAgentMessage,
  addNote,
  startConversation,
} from '../controllers/inbox.controller.js';
import {
  sendMessageValidator,
  assignAgentValidator,
  setAutomationValidator,
  noteValidator,
} from '../validators/inbox.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/conversations', listConversations);
router.post('/conversations', startConversation);
router.get('/conversations/:id', getConversation);
router.get('/conversations/:id/messages', listMessages);
router.post('/conversations/:id/messages', sendMessageValidator, validate, sendAgentMessage);
router.post('/conversations/:id/read', markRead);
router.post('/conversations/:id/assign', assignAgentValidator, validate, assignAgent);
router.post('/conversations/:id/automation', setAutomationValidator, validate, setAutomation);
router.post('/conversations/:id/notes', noteValidator, validate, addNote);

export default router;
