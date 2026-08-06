import { Router } from 'express';
import { requireAuth, requireModule, requirePermission } from '../../middleware/auth.js';
import {
  getTicket, listTickets, patchTicketAssignee, patchTicketStatus, postTicket,
  postTicketNote, postTicketUpdate,
} from './ticket.controller.js';

// Customer support.
//
// `requireModule('SUPPORT')` once, module-wide, immediately after
// authentication — same reasoning as Leads: a module where one endpoint forgot
// the gate is a module that is not gated.

const router = Router();

router.use(requireAuth);
router.use(requireModule('SUPPORT'));

router.get('/', requirePermission('tickets:read'), listTickets);
router.post('/', requirePermission('tickets:write'), postTicket);

router.get('/:ticketId', requirePermission('tickets:read'), getTicket);

// `tickets:write` gets you as far as the working states. Reaching RESOLVED or
// CLOSED additionally needs `tickets:close`, checked inside the handler because
// the permission required depends on the *value* being set, which a route-level
// guard cannot see.
router.patch('/:ticketId/status', requirePermission('tickets:write'), patchTicketStatus);
router.patch('/:ticketId/assignee', requirePermission('tickets:assign'), patchTicketAssignee);

router.post('/:ticketId/notes', requirePermission('tickets:write'), postTicketNote);
router.post('/:ticketId/updates', requirePermission('tickets:write'), postTicketUpdate);

export default router;
