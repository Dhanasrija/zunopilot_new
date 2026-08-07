import { body } from 'express-validator';

export const sendMessageValidator = [
  body('body').isString().trim().isLength({ min: 1, max: 4000 }),
];

export const sendMediaValidator = [
  body('mediaId').isUUID(),
  // A caption is optional, and WhatsApp's own limit is 1024 — not 4000. Accepting more here
  // would mean Meta refusing the send after the file had already been uploaded.
  body('caption').optional({ nullable: true }).isString().trim().isLength({ max: 1024 }),
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
