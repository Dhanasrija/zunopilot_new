import { body } from 'express-validator';

// Only the email-verification link is validated here any more.
//
// `signupValidator` and `loginValidator` are gone: customers sign in with a phone
// number and a one-time code, and both of those routes are validated with Zod in
// `controllers/auth.controller.ts`. The old signup validator also enforced the
// removed `RESTAURANT | ECOMMERCE_GROCERY` enum, which would now reject any
// category an operator adds.

export const verifyEmailValidator = [body('token').isString().notEmpty()];
