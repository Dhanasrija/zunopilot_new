import { body } from 'express-validator';

export const signupValidator = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Min 8 chars'),
  body('fullName').trim().isLength({ min: 2 }),
  body('businessName').trim().isLength({ min: 2 }),
  body('category').optional().isIn(['RESTAURANT', 'SALON', 'RETAIL', 'CLINIC', 'OTHER']),
  body('contactNumber').optional().isString(),
  body('address').optional().isString(),
  body('website').optional().isURL(),
];

export const loginValidator = [
  body('email').isEmail().normalizeEmail(),
  body('password').isString().notEmpty(),
];

export const verifyEmailValidator = [body('token').isString().notEmpty()];
