import { Router } from 'express';
import auth from './auth.routes.js';
import tenant from './tenant.routes.js';
import whatsapp from './whatsapp.routes.js';
import webhook from './webhook.routes.js';
import automation from './automation.routes.js';
import inbox from './inbox.routes.js';
import menu from './menu.routes.js';
import order from './order.routes.js';
import template from './template.routes.js';
import customer from './customer.routes.js';
import analytics from './analytics.routes.js';

export const routes = Router();

routes.use('/auth', auth);
routes.use('/tenant', tenant);
routes.use('/whatsapp', whatsapp);
routes.use('/webhook', webhook);
routes.use('/automation', automation);
routes.use('/inbox', inbox);
routes.use('/menu', menu);
routes.use('/orders', order);
routes.use('/templates', template);
routes.use('/customers', customer);
routes.use('/analytics', analytics);
