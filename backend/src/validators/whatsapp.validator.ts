import { body } from 'express-validator';

export const embeddedSignupValidator = [
  body('wabaId').isString().notEmpty(),
  body('phoneNumberId').isString().notEmpty(),
  body('displayPhone').optional().isString(),
  body('businessName').optional().isString(),
  body('code').optional().isString(),
  body('accessToken').optional().isString(),
  // Six-digit two-step PIN for POST /{phone_number_id}/register.
  body('pin').optional().isString().matches(/^\d{6}$/).withMessage('pin must be 6 digits'),
];
