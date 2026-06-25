import { body } from 'express-validator';

export const sendMessageValidator = [
  body('body').isString().trim().isLength({ min: 1, max: 4000 }),
];

export const assignAgentValidator = [
  body('agentId').optional({ nullable: true }).isUUID(),
];

export const setAutomationValidator = [
  body('paused').isBoolean(),
];

export const noteValidator = [
  body('body').isString().trim().isLength({ min: 1, max: 2000 }),
];
