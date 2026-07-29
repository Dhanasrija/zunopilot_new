import { body } from 'express-validator';

export const updateTenantValidator = [
  body('businessName').optional().trim().isLength({ min: 2 }).withMessage('must be at least 2 characters'),
  body('category').optional().isIn(['RESTAURANT', 'ECOMMERCE_GROCERY']).withMessage('must be either RESTAURANT or ECOMMERCE_GROCERY'),
  body('contactNumber').optional().isString().withMessage('must be a valid string'),
  body('address').optional().isString().withMessage('must be a valid string'),
  body('website').optional().isURL().withMessage('must be a valid URL'),
  body('logoUrl').optional().isURL().withMessage('must be a valid URL'),
];
