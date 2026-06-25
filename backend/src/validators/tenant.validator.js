import { body } from 'express-validator';

export const updateTenantValidator = [
  body('businessName').optional().trim().isLength({ min: 2 }),
  body('category').optional().isIn(['RESTAURANT', 'SALON', 'RETAIL', 'CLINIC', 'OTHER']),
  body('contactNumber').optional().isString(),
  body('address').optional().isString(),
  body('website').optional().isURL(),
  body('logoUrl').optional().isURL(),
];
