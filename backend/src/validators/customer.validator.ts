import { body } from 'express-validator';

export const createCustomerValidator = [
  body('waId').isString().trim().notEmpty().withMessage('WhatsApp number is required'),
  body('name').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body('phone').optional({ nullable: true }).isString().trim().isLength({ max: 32 }),
];

// `waId` and `lifetimeSpend` are intentionally absent: one is the record's
// identity, the other is derived from delivered orders. See the controller.
export const updateCustomerValidator = [
  body('name').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  body('phone').optional({ nullable: true }).isString().trim().isLength({ max: 32 }),
  // Shape only. The contents are trimmed, lowercased, de-duplicated and capped by
  // `normaliseTags` in the controller, which is also where the readable errors come from —
  // duplicating those rules here would let the two drift apart.
  body('tags').optional().isArray({ max: 20 }).withMessage('Tags must be a list of at most 20'),
];
