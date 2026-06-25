import { body } from 'express-validator';

export const categoryValidator = [
  body('name').isString().trim().isLength({ min: 1, max: 100 }),
  body('description').optional().isString(),
  body('sortOrder').optional().isInt(),
  body('isActive').optional().isBoolean(),
];

export const itemValidator = [
  body('categoryId').optional().isUUID(),
  body('name').isString().trim().isLength({ min: 1, max: 200 }),
  body('description').optional().isString(),
  body('basePrice').isFloat({ min: 0 }),
  body('imageUrl').optional().isURL(),
  body('inStock').optional().isBoolean(),
  body('sortOrder').optional().isInt(),
  body('addonGroupIds').optional().isArray(),
];

export const addonGroupValidator = [
  body('name').isString().trim().isLength({ min: 1, max: 100 }),
  body('minSelect').optional().isInt({ min: 0 }),
  body('maxSelect').optional().isInt({ min: 1 }),
  body('options').optional().isArray(),
  body('options.*.name').optional().isString(),
  body('options.*.priceDelta').optional().isFloat(),
];
