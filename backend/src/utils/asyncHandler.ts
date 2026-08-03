import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wrap async route handlers so rejections flow into the global error middleware. */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
