import { body } from 'express-validator';

/** Creating a rule: both halves are required, because a rule needs a trigger and an answer. */
export const createKeywordValidator = [
  body('keywords').isArray({ min: 1 }).withMessage('At least one keyword'),
  body('keywords.*').isString().trim().notEmpty(),
  body('response').isString().trim().isLength({ min: 1, max: 1000 }),
  body('priority').optional().isInt(),
  body('isActive').optional().isBoolean(),
];

/**
 * Updating a rule: every field optional, but a body that changes nothing is refused.
 *
 * This used to reuse the create validator, which made `keywords` and `response` mandatory on a
 * PATCH — so flipping a switch meant resending the entire rule, and the composer did exactly
 * that (`Automation.tsx` read the row out of its own cache to rebuild the payload). That is a
 * lost update waiting to happen: two people editing one rule, and the toggle writes back a
 * stale response it never intended to touch.
 *
 * `updateKeywordRule` already builds its `data` from whichever fields are present, so the
 * controller never needed the requirement — only the validator did.
 */
export const updateKeywordValidator = [
  body('keywords').optional().isArray({ min: 1 }).withMessage('At least one keyword'),
  body('keywords.*').optional().isString().trim().notEmpty(),
  body('response').optional().isString().trim().isLength({ min: 1, max: 1000 }),
  body('priority').optional().isInt(),
  body('isActive').optional().isBoolean(),
  // Without this an empty PATCH is a silent 200 that changed nothing, which reads to the caller
  // as a save that worked.
  body().custom((value: Record<string, unknown>) => {
    const fields = ['keywords', 'response', 'priority', 'isActive'];
    if (!fields.some((field) => value?.[field] !== undefined)) {
      throw new Error('Nothing to update');
    }
    return true;
  }),
];

export const fallbackValidator = [
  body('response').isString().trim().isLength({ min: 1, max: 1000 }),
];
