import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireSuperAdmin } from './auth.js';
import * as sa from './super-admin.controller.js';

// Super admin routes.
//
// Login is rate limited hard and separately from everything else. This is a
// console that can read every workspace on the platform behind a single
// password, so it is the one endpoint on the estate most worth brute-forcing —
// and unlike the customer API there is no tenant to scope the damage to.

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Raised under test rather than skipped: the limiter still runs on every
  // request in every environment, so the middleware itself stays exercised and
  // there is no `if (test)` branch in the auth path that could ever be true in
  // production. Only the threshold moves — a suite that signs in two dozen times
  // is not an attack.
  limit: process.env.NODE_ENV === 'test' ? 10_000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Keyed on IP deliberately, not on the submitted email: keying on email lets
  // an attacker rotate the address to get a fresh allowance each time.
  message: { success: false, message: 'Too many sign-in attempts. Try again in a few minutes.' },
});

export const superAdminRoutes = Router();

superAdminRoutes.post('/auth/login', loginLimiter, sa.login);

// Everything below requires an operator token.
superAdminRoutes.use(requireSuperAdmin);

superAdminRoutes.get('/auth/me', sa.me);
superAdminRoutes.get('/overview', sa.overview);

superAdminRoutes.get('/tenants', sa.listTenants);
superAdminRoutes.get('/tenants/:tenantId', sa.getTenant);
superAdminRoutes.get('/tenants/:tenantId/activity', sa.getTenantActivity);
superAdminRoutes.patch('/tenants/:tenantId/active', sa.setTenantActive);
superAdminRoutes.post('/tenants/:tenantId/plan', sa.assignTenantPlan);
superAdminRoutes.get('/tenants/:tenantId/modules', sa.getTenantModules);
superAdminRoutes.patch('/tenants/:tenantId/modules', sa.setTenantModule);

superAdminRoutes.patch('/users/:userId', sa.updateUser);

// Module 23: contact enquiries. Platform-level, so no tenant in the path.
superAdminRoutes.get('/enquiries', sa.listEnquiriesHandler);
superAdminRoutes.patch('/enquiries/:enquiryId', sa.updateEnquiryHandler);

superAdminRoutes.get('/plans', sa.listPlans);
superAdminRoutes.get('/audit', sa.listAudit);

// Support access. The operator can request, watch and end — never grant.
superAdminRoutes.get('/tenants/:tenantId/impersonation', sa.listImpersonation);
superAdminRoutes.post('/tenants/:tenantId/impersonation', sa.requestImpersonation);
superAdminRoutes.post('/tenants/:tenantId/impersonation/:grantId/token', sa.startImpersonation);
superAdminRoutes.post('/tenants/:tenantId/impersonation/:grantId/end', sa.endImpersonation);

// Connector types — the catalog of outside systems a workspace can connect to.
// A type says how to authenticate, never with what: the tenant supplies the
// credential when they create the connector, so nothing here is a secret.
superAdminRoutes.get('/connector-types', sa.listConnectorTypes);
superAdminRoutes.post('/connector-types', sa.createConnectorType);
superAdminRoutes.patch('/connector-types/:typeId', sa.updateConnectorType);
superAdminRoutes.delete('/connector-types/:typeId', sa.deleteConnectorType);
superAdminRoutes.post('/connector-types/:typeId/operations', sa.createConnectorTypeOperation);
superAdminRoutes.patch('/connector-types/:typeId/operations/:operationId', sa.updateConnectorTypeOperation);
superAdminRoutes.delete('/connector-types/:typeId/operations/:operationId', sa.deleteConnectorTypeOperation);

// Business categories — what a workspace can pick on the profile page.
superAdminRoutes.get('/business-categories', sa.listBusinessCategories);
superAdminRoutes.post('/business-categories', sa.createBusinessCategory);
superAdminRoutes.patch('/business-categories/:categoryId', sa.updateBusinessCategory);
superAdminRoutes.delete('/business-categories/:categoryId', sa.deleteBusinessCategory);
