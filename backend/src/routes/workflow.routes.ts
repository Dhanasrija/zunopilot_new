import { Router } from 'express';
import {
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  setWorkflowStatus,
  duplicateWorkflow,
  deleteWorkflow,
} from '../controllers/workflow.controller.js';
import {
  createWorkflowValidator,
  updateWorkflowValidator,
  workflowStatusValidator,
} from '../validators/workflow.validator.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('workflows:read'), listWorkflows);
router.get('/:id', requirePermission('workflows:read'), getWorkflow);

// Workflows will eventually drive automated replies to customers, so authoring
// and publishing them is restricted to OWNER/MANAGER rather than every agent.
router.post('/', requirePermission('workflows:author'), createWorkflowValidator, validate, createWorkflow);
router.patch('/:id', requirePermission('workflows:author'), updateWorkflowValidator, validate, updateWorkflow);
router.post('/:id/status', requirePermission('workflows:author'), workflowStatusValidator, validate, setWorkflowStatus);
router.post('/:id/duplicate', requirePermission('workflows:author'), duplicateWorkflow);
router.delete('/:id', requirePermission('workflows:delete'), deleteWorkflow);

export default router;
