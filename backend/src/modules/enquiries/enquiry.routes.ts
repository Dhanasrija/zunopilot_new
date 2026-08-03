import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { createEnquiry } from './enquiry.service.js';

// The public contact endpoint.
//
// Unauthenticated by necessity — the person filling in the form has no account and
// is trying to get one. That makes it the only write on the customer API reachable
// without a token, so the limits below are the whole defence.

/**
 * 5 an hour per IP.
 *
 * Keyed on IP and **not** on the submitted email: keying on a value the submitter
 * controls hands out a fresh allowance for every address they invent.
 *
 * The threshold is *raised* under test rather than skipped, so the middleware runs
 * on every request in every environment and there is no `if (test)` branch that
 * could ever be true in production. Same pattern as the super admin login limiter.
 *
 * Five is deliberately generous for a human and useless for a script. A genuine
 * prospect submits once; someone correcting a typo submits twice.
 */
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 10_000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many enquiries from this connection. Try again later, or email us directly.',
  },
});

/**
 * Mirrors the validation `Contact.tsx` already does, because a client-side check is
 * a convenience and never a control.
 *
 * `interest` is a bounded string rather than an enum: the six options are marketing
 * copy on the page, and an enum here would mean a backend deploy to add a seventh —
 * and a rejected enquiry on the day the two drifted apart.
 */
const contactSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  // Just the dial code, e.g. `+91`. Joined to the number in the service.
  dialCode: z.string().trim().regex(/^\+\d{1,4}$/, 'Invalid country code').default('+91'),
  // A floor, not a format check — the two layers have different jobs. This only
  // catches an absent or absurd value; whether the number *parses* is the service's
  // problem, and it deliberately keeps unparseable ones rather than rejecting them.
  // A stricter rule here would defeat that fallback by 400-ing first, which is
  // exactly what an earlier `min(6)` did.
  phone: z.string().trim().min(4).max(20),
  interest: z.string().trim().min(1).max(80),
  // 1000 to match the counter the form already shows the visitor.
  message: z.string().trim().min(1).max(1000),
});

export const contactRoutes = Router();

contactRoutes.post(
  '/',
  contactLimiter,
  asyncHandler(async (req, res) => {
    const body = contactSchema.parse(req.body);

    await createEnquiry({
      ...body,
      // `app.set('trust proxy', 1)` is already set, so this is the client address
      // rather than nginx's.
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });

    // Nothing but an acknowledgement. An anonymous caller has no use for the id,
    // and echoing the submission back is a reflected-content footgun for free.
    res.status(201).json({ success: true, data: { received: true } });
  }),
);
