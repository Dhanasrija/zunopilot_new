import { body } from 'express-validator';

export const signupValidator = [
  body('email').isEmail().withMessage('must be a valid email address').normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('must be at least 8 characters'),
  body('fullName').trim().isLength({ min: 2 }).withMessage('must be at least 2 characters'),
  body('businessName').trim().isLength({ min: 2 }).withMessage('must be at least 2 characters'),
  body('category').optional().isIn(['RESTAURANT', 'ECOMMERCE_GROCERY']).withMessage('must be either RESTAURANT or ECOMMERCE_GROCERY'),
  body('contactNumber').optional().isString().withMessage('must be a valid string'),
  body('address').optional().isString().withMessage('must be a valid string'),
  body('website').optional().isURL().withMessage('must be a valid URL'),
];

export const loginValidator = [
  body('email').isEmail().normalizeEmail(),
  body('password').isString().notEmpty(),
];

export const verifyEmailValidator = [body('token').isString().notEmpty()];
