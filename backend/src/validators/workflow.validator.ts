import { body } from 'express-validator';

const TRIGGERS = ['MESSAGE_RECEIVED', 'ORDER_STATUS_CHANGED', 'MANUAL'];

// The graph is validated structurally only — that it is an object with node and
// edge arrays. Per-node-type config is the editor's concern and will keep
// changing; a strict schema here would reject valid graphs every time a node
// gains a field.
const graphRule = body('graph')
  .optional()
  .custom((g) => {
    if (g === null) return true;
    if (typeof g !== 'object' || Array.isArray(g)) throw new Error('graph must be an object');
    if (g.nodes !== undefined && !Array.isArray(g.nodes)) throw new Error('graph.nodes must be an array');
    if (g.edges !== undefined && !Array.isArray(g.edges)) throw new Error('graph.edges must be an array');
    return true;
  });

export const createWorkflowValidator = [
  body('name').isString().trim().isLength({ min: 1, max: 120 }).withMessage('Name is required'),
  body('description').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('trigger').optional().isIn(TRIGGERS),
  graphRule,
];

export const updateWorkflowValidator = [
  body('name').optional().isString().trim().isLength({ min: 1, max: 120 }),
  body('description').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
  body('trigger').optional().isIn(TRIGGERS),
  graphRule,
];

export const workflowStatusValidator = [
  body('status').isIn(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
];
