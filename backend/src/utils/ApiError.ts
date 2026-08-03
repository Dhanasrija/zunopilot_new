export class ApiError extends Error {
  readonly statusCode: number;
  readonly details: unknown;
  readonly isOperational = true;

  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(message: string, details?: unknown) { return new ApiError(400, message, details); }
  static unauthorized(message = 'Unauthorized') { return new ApiError(401, message); }
  static forbidden(message = 'Forbidden') { return new ApiError(403, message); }
  static notFound(message = 'Not found') { return new ApiError(404, message); }
  static conflict(message: string, details?: unknown) { return new ApiError(409, message, details); }
  static unprocessable(message: string, details?: unknown) { return new ApiError(422, message, details); }
  static tooManyRequests(message = 'Too many requests') { return new ApiError(429, message); }
  static internal(message = 'Internal server error') { return new ApiError(500, message); }
}
