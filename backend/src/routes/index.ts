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
import team from './team.routes.js';
import roles from './role.routes.js';
import leads from '../modules/leads/lead.routes.js';
import tickets from '../modules/support/ticket.routes.js';
import campaigns from '../modules/marketing/campaign.routes.js';
import { contactRoutes } from '../modules/enquiries/enquiry.routes.js';
import {
  billingRoutes, publicPricingRoutes, razorpayWebhookRoutes,
} from '../modules/billing/routes.js';
import analytics from './analytics.routes.js';
import workflow from './workflow.routes.js';
import { impersonationRoutes } from './impersonation.routes.js';
import {
  assistantRoutes, connectorRoutes, conversationEngineRoutes, engineWorkflowRoutes, instanceRoutes,
  templateRoutes,
} from '../modules/conversation-engine/http/routes.js';

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
routes.use('/team', team);
// Module 18: the workspace's own roles and what each may do.
routes.use('/roles', roles);
// Module 14: billing. `/pricing` is deliberately unauthenticated — the pricing
// page must show the same records checkout charges from.
routes.use('/pricing', publicPricingRoutes);
routes.use('/billing', billingRoutes);
routes.use('/webhooks', razorpayWebhookRoutes);
routes.use('/analytics', analytics);
// Module 12: conversation engine.
//
// `/workflows/:workflowId/...` is mounted BEFORE the legacy `/workflows`
// router. The two coexist during the transition: the legacy router owns the
// collection endpoints (`GET /workflows`, `POST /workflows`) that the current
// canvas still uses, and the engine owns the per-workflow sub-resources
// (capability, versions, publish, validate, test) that it does not.
routes.use('/assistants', assistantRoutes);
routes.use('/workflows', engineWorkflowRoutes);
routes.use('/workflow-instances', instanceRoutes);
routes.use('/workflow-templates', templateRoutes);
routes.use('/conversations', conversationEngineRoutes);
// Module 16: support access. The workspace's own consent surface — approving,
// denying and ending a support engineer's read-only session, plus the log of what
// was looked at. On the customer API on purpose: an audit trail only the watcher
// can read is not accountability.
routes.use('/support-access', impersonationRoutes);

// Module 13: connectors.
routes.use('/connectors', connectorRoutes);

// Module 20: leads. Behind `requireModule('LEADS')` inside its own router, so a
// workspace that was never given the module gets a 404 rather than a 403 — the
// same answer as a route that does not exist.
routes.use('/leads', leads);

// Module 21: customer support. Same gating shape as leads.
routes.use('/tickets', tickets);

// Module 22: marketing.
routes.use('/campaigns', campaigns);

// Module 23: contact enquiries.
//
// **Deliberately unauthenticated**, like `/pricing` above — the person filling in
// the marketing form has no account and is trying to get one. It is the only write
// on this API reachable without a token, so its own IP-keyed rate limiter is the
// defence. Enquiries are platform-level and are read only from the super admin
// console; they are not tenant `Lead`s.
routes.use('/contact', contactRoutes);

routes.use('/workflows', workflow);
