import { body } from 'express-validator';

export const templateValidator = [
  body('name').isString().trim().notEmpty(),
  body('trigger').isIn(['ORDER_CREATED', 'ORDER_ACCEPTED', 'ORDER_PREPARING', 'ORDER_READY', 'ORDER_OUT_FOR_DELIVERY', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'CUSTOM']),
  body('metaTemplate').isString().trim().notEmpty(),
  body('language').optional().isString(),
  body('body').isString().trim().notEmpty(),
  body('isActive').optional().isBoolean(),
];
