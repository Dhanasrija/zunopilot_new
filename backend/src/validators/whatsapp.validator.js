import { body } from 'express-validator';

export const embeddedSignupValidator = [
  body('wabaId').isString().notEmpty(),
  body('phoneNumberId').isString().notEmpty(),
  body('displayPhone').optional().isString(),
  body('businessName').optional().isString(),
  body('code').optional().isString(),
  body('accessToken').optional().isString(),
];
