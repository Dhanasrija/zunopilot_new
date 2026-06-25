import { body } from 'express-validator';

export const upsertKeywordValidator = [
  body('keywords').isArray({ min: 1 }).withMessage('At least one keyword'),
  body('keywords.*').isString().trim().notEmpty(),
  body('response').isString().trim().isLength({ min: 1, max: 1000 }),
  body('priority').optional().isInt(),
  body('isActive').optional().isBoolean(),
];

export const fallbackValidator = [
  body('response').isString().trim().isLength({ min: 1, max: 1000 }),
];
