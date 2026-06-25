import { body } from 'express-validator';

export const updateStatusValidator = [
  body('status').isIn(['NEW', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']),
];

export const createOrderValidator = [
  body('customerId').isUUID().withMessage('Valid customerId required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item required'),
  body('items.*.itemId').isUUID().withMessage('Each item must have a valid itemId'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('deliveryAddress').optional().isString(),
  body('notes').optional().isString(),
];
