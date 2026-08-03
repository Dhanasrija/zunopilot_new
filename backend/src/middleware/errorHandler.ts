import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';

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
  const statusCode = isApiError ? error.statusCode : error.statusCode || 500;
  const message = error.message || 'Internal server error';

  if (statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${statusCode}: ${message}`, {
      stack: error.stack,
    });
  } else {
    logger.warn(`${req.method} ${req.originalUrl} -> ${statusCode}: ${message}`);
  }

  res.status(statusCode).json({
    success: false,
    message,
    details: error.details,
    ...(process.env.NODE_ENV !== 'production' && !isApiError ? { stack: error.stack } : {}),
  });
};
