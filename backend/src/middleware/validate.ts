import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { validationResult } from 'express-validator';
import { z, type ZodTypeAny } from 'zod';
import { ApiError } from '../utils/ApiError.js';

// Two validation styles live here on purpose.
//
// `validate` drains express-validator chains and is what every pre-existing
// route uses. `validateBody`/`validateQuery`/`validateParams` are Zod-based and
// are what the conversation engine uses, because its payloads (workflow
// definitions, capability contracts, router output) are nested documents that
// express-validator cannot describe. New routes should use the Zod helpers.

/** Run after express-validator chains to reject on validation errors. */
export const validate = (req: Request, _res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const details = errors.array().map((e) => ({
    field: 'path' in e ? e.path : undefined,
    message: e.msg,
    value: 'value' in e ? e.value : undefined,
  }));
  const errorMessage = 'Validation failed: ' + details.map((d) => `${d.field} ${d.message}`).join(', ');
  return next(ApiError.badRequest(errorMessage, details));
};

export interface ZodIssueDetail {
  field: string;
  message: string;
}

export const zodIssues = (error: z.ZodError): ZodIssueDetail[] =>
  error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));

const zodValidator = (source: 'body' | 'query' | 'params') =>
  <T extends ZodTypeAny>(schema: T): RequestHandler => (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = zodIssues(result.error);
      return next(ApiError.badRequest(
        `Validation failed: ${details.map((d) => `${d.field} ${d.message}`).join(', ')}`,
        details,
      ));
    }
    // Reassigning the parsed value is deliberate: it applies coercion, strips
    // unknown keys, and means the controller reads validated data rather than
    // whatever the client sent.
    Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
    next();
  };

export const validateBody = zodValidator('body');
export const validateQuery = zodValidator('query');
export const validateParams = zodValidator('params');
