import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Turn the Prisma errors that are really the caller's fault into a clean 4xx.
 *
 * Without this they fell through as 500s carrying Prisma's own prose. Three codes cover
 * essentially all of it in practice:
 *
 *   P2002 — unique constraint. The caller asked for something that already exists.
 *   P2003 — foreign key. The caller referenced a row that does not.
 *   P2025 — the record required by the operation was not found.
 *
 * The returned message deliberately names no table, column or constraint. `meta.target`
 * would make a nicer error and is exactly the schema detail that must not leave the process,
 * so the specifics stay in the log line above.
 */
const prismaFailure = (err: unknown): { status: number; message: string } | null => {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;
  switch (err.code) {
    case 'P2002': return { status: 409, message: 'That already exists' };
    case 'P2003': return { status: 400, message: 'That refers to something which does not exist' };
    case 'P2025': return { status: 404, message: 'Not found' };
    default: return null;
  }
};

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};

// Global error handler.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // A schema failure is the caller's problem, not the server's. Left to fall
  // through it became a 500 with a wall of Zod internals as the message —
  // which reads as "we broke" and tells the caller nothing actionable.
  if (err instanceof ZodError) {
    const issues = err.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      message: issue.message,
    }));
    logger.warn(`${req.method} ${req.originalUrl} -> 400: ${issues.map((i) => `${i.field} ${i.message}`).join('; ')}`);
    res.status(400).json({
      success: false,
      message: issues.map((i) => (i.field === '(body)' ? i.message : `${i.field}: ${i.message}`)).join('; '),
      details: issues,
    });
    return;
  }

  const error = err as Error & { statusCode?: number; details?: unknown };
  const isApiError = error instanceof ApiError;
  const prismaFault = prismaFailure(err);
  const statusCode = isApiError
    ? error.statusCode
    : prismaFault?.status ?? error.statusCode ?? 500;

  // What the log gets: everything, plus the id the client was handed in `X-Request-Id`, so a
  // reported failure can be found rather than guessed at.
  const internalMessage = error.message || 'Internal server error';
  const requestId = (req as Request & { requestId?: string }).requestId;
  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${statusCode}: ${internalMessage}`, {
      requestId,
      stack: error.stack,
    });
  } else {
    logger.warn(`${req.method} ${req.originalUrl} -> ${statusCode}: ${internalMessage}`, {
      requestId,
    });
  }

  /*
   * An `ApiError` was written for the caller, so it is safe to send. A Prisma error was
   * written for us, and it is not: its message quotes table and column names, the failing
   * constraint, and sometimes the offending value.
   *
   * This used to send `error.message` unconditionally — only `stack` was environment-gated —
   * so a unique-constraint violation handed the caller a description of the schema. And the
   * gate that did exist read `NODE_ENV !== 'production'`, which is the wrong way round for
   * this codebase: `NODE_ENV` is set nowhere in it, so the *absence* of configuration chose
   * the more revealing branch. Both are inverted here — a raw message needs `development`
   * to be asked for by name.
   */
  const clientMessage = isApiError
    ? internalMessage
    : prismaFault?.message
      ?? (process.env.NODE_ENV === 'development' ? internalMessage : 'Internal server error');

  res.status(statusCode).json({
    success: false,
    message: clientMessage,
    details: error.details,
    ...(process.env.NODE_ENV === 'development' && !isApiError ? { stack: error.stack } : {}),
  });
};
