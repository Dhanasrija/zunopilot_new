import { body } from 'express-validator';

export const updateTenantValidator = [
  body('businessName').optional().trim().isLength({ min: 2 }).withMessage('must be at least 2 characters'),
  body('category').optional().isIn(['RESTAURANT', 'ECOMMERCE_GROCERY']).withMessage('must be either RESTAURANT or ECOMMERCE_GROCERY'),
  body('contactNumber').optional().isString().withMessage('must be a valid string'),
  body('address').optional().isString().withMessage('must be a valid string'),
  body('website').optional().isURL().withMessage('must be a valid URL'),
  body('logoUrl').optional().isURL().withMessage('must be a valid URL'),
  // Both switches accept a real boolean or its string form, because a form post sends strings.
  // `isBoolean` with no options rejects `"true"`, which is exactly what an HTML form sends, so
  // the controller does the strict coercion and this only rejects values that are neither.
  body('aiAgentEnabled').optional().isBoolean({ strict: false }).withMessage('must be true or false'),
  body('maskCustomerNumbers').optional().isBoolean({ strict: false }).withMessage('must be true or false'),
];
