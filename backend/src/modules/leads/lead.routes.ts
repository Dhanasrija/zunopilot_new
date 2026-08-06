import { Router } from 'express';
import { requireAuth, requireModule, requirePermission } from '../../middleware/auth.js';
import {
  bulkAssignLeads, deleteLead, getLead, listLeads, listMyReminders, patchLead,
  patchLeadOwner, patchLeadStatus, patchReminderComplete, postLead, postLeadCall,
  postLeadNote, postLeadReminder,
} from './lead.controller.js';

// Leads.
//
// `requireModule('LEADS')` is mounted **once, module-wide**, immediately after
// authentication. Per-route would mean a module where three endpoints forgot the
// gate is a module that is not gated — and the one that gets forgotten is always
// the one added last, in a hurry.
//
// Two questions, both asked on every request: has this workspace been given
// Leads (the operator's decision), and may this person do this (the workspace's).

const router = Router();

router.use(requireAuth);
router.use(requireModule('LEADS'));

// This person's own open reminders. Before `/:leadId` so the literal path is not
// swallowed by the parameter route.
router.get('/reminders/mine', requirePermission('leads:read'), listMyReminders);
router.patch('/reminders/:reminderId/complete', requirePermission('leads:write'), patchReminderComplete);

router.get('/', requirePermission('leads:read'), listLeads);
router.post('/', requirePermission('leads:write'), postLead);

// Bulk assignment is `leads:assign`, not `leads:write`: handing a hundred leads
// to someone is a different act from editing one.
router.post('/bulk-assign', requirePermission('leads:assign'), bulkAssignLeads);

router.get('/:leadId', requirePermission('leads:read'), getLead);
router.patch('/:leadId', requirePermission('leads:write'), patchLead);
router.delete('/:leadId', requirePermission('leads:delete'), deleteLead);

router.patch('/:leadId/status', requirePermission('leads:write'), patchLeadStatus);
router.patch('/:leadId/owner', requirePermission('leads:assign'), patchLeadOwner);
router.post('/:leadId/notes', requirePermission('leads:write'), postLeadNote);
router.post('/:leadId/calls', requirePermission('leads:write'), postLeadCall);
router.post('/:leadId/reminders', requirePermission('leads:write'), postLeadReminder);

export default router;
