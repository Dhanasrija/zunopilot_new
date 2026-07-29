import { validationResult } from 'express-validator';
import { ApiError } from '../utils/ApiError.js';

// Run after express-validator chains to reject on validation errors.
export const validate = (req, _res, next) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const details = errors.array().map((e) => ({
    field: e.path,
    message: e.msg,
    value: e.value,
  }));
  const errorMessage = 'Validation failed: ' + details.map((d) => `${d.field} ${d.message}`).join(', ');
  return next(ApiError.badRequest(errorMessage, details));
};
