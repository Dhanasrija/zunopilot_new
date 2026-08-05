import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../../config/env.js';
import { requireAuth, requirePermission, tenantIdOf } from '../../../middleware/auth.js';
import { validateBody, validateParams, validateQuery } from '../../../middleware/validate.js';
import * as assistants from './assistants.controller.js';
import * as workflows from './workflows.controller.js';
import * as instances from './instances.controller.js';
import * as routing from './routing.controller.js';
import * as connectors from './connectors.controller.js';
import {
  assistantIdParam, cancelInstanceSchema, createFromTemplateSchema, createRoutingRuleSchema, createRoutingTestSchema,
  createVersionSchema, createWorkflowSchema, handoffSchema, listInstancesQuery,
  listWorkflowsQuery, publishWorkflowSchema, putCapabilitySchema, routeTestSchema,
  simulatorReplySchema, testWorkflowSchema, updateAssistantSchema, updateRoutingConfigSchema,
  updateRoutingRuleSchema, updateWorkflowSchema, validateWorkflowSchema, workflowIdParam,
} from './schemas.js';

// Conversation-engine routes.
//
// Role policy, applied per verb rather than per router:
//   • read           — any authenticated member of the workspace
//   • author         — OWNER / MANAGER (MANAGER is this product's "builder")
//   • publish/delete — OWNER only, because publishing points a graph at real
//                      customers and deleting discards execution history
//
// Route-test and the simulator sit behind their own limiter: each call can
// cost an LLM completion, so an unbounded loop is a bill as well as load.

// Named capabilities rather than a role list, so a workspace's own role can reach
// these. `owner` used to mean the OWNER enum; publishing and deleting are now two
// distinct grants, because they are two distinct risks: publishing points a graph at
// real customers, deleting takes its run history away.
const author = requirePermission('workflows:author');
/**
 * Connector authoring is its own grant.
 *
 * It used to share the workflow gate because both were "OWNER or MANAGER". They are
 * different jobs: registering a connector means handing ZunoPilot a credential and a
 * base URL for someone else's system, which is not the same trust as drawing a graph.
 */
const connectorAuthor = requirePermission('connectors:author');
const publisher = requirePermission('workflows:publish');
const remover = requirePermission('workflows:delete');
/**
 * Reading a workflow is a named grant too, not a side effect of being signed in.
 *
 * This router is mounted at `/workflows` **before** the legacy one in `routes/index.ts`, so
 * whichever path it defines it answers first. `GET /:workflowId` had only `requireAuth`,
 * which meant the legacy router's `requirePermission('workflows:read')` on the identical URL
 * never ran: a role with that permission deliberately withheld still got the full node
 * graph. Shadowing makes the gate silently unreachable rather than visibly absent, which is
 * why it survived — the same way the connector reads below did, see the note there.
 */
const reader = requirePermission('workflows:read');
/**
 * Seizing or releasing a live conversation is the inbox's automation toggle by another name,
 * so it answers to the same grant. `inbox.routes.ts` has always gated the equivalent action;
 * these two endpoints took any authenticated member, including one whose role holds nothing.
 */
const automationToggler = requirePermission('inbox:toggle_automation');

/**
 * Rate limit for anything that can trigger an LLM completion.
 *
 * Every route-test, suite run and dry run is a real model call on the tenant's
 * bill. The global 300/min on `/api` is far too loose for that — a stuck
 * frontend retry loop would spend money as fast as it can issue requests.
 *
 * Keyed by tenant, not by IP: an office behind one NAT is one IP and many
 * users, and a per-IP budget would throttle them collectively while letting a
 * single tenant across many IPs run unbounded.
 */
const llmLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => tenantIdOf(req),
  skip: () => env.isTest,
  message: {
    success: false,
    message: 'Too many test runs in the last minute. Each one calls the model — pause and retry shortly.',
  },
});

/**
 * The suite runs one completion per saved case, so it is far more expensive
 * than a single test and gets its own, tighter budget.
 */
const suiteLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => tenantIdOf(req),
  skip: () => env.isTest,
  message: {
    success: false,
    message: 'The routing suite can be run 5 times per 5 minutes. Each run calls the model once per test case.',
  },
});

export const assistantRoutes = Router();
assistantRoutes.use(requireAuth);

assistantRoutes.get('/', assistants.listAssistants);
assistantRoutes.get('/:assistantId', validateParams(assistantIdParam), assistants.getAssistant);
assistantRoutes.patch('/:assistantId', validateParams(assistantIdParam), author, validateBody(updateAssistantSchema), assistants.updateAssistant);

assistantRoutes.get('/:assistantId/routing', validateParams(assistantIdParam), assistants.getRoutingConfig);
assistantRoutes.patch('/:assistantId/routing', validateParams(assistantIdParam), author, validateBody(updateRoutingConfigSchema), assistants.updateRoutingConfig);

assistantRoutes.get('/:assistantId/rules', validateParams(assistantIdParam), assistants.listRoutingRules);
assistantRoutes.post('/:assistantId/rules', validateParams(assistantIdParam), author, validateBody(createRoutingRuleSchema), assistants.createRoutingRule);
assistantRoutes.patch('/:assistantId/rules/:ruleId', author, validateBody(updateRoutingRuleSchema), assistants.updateRoutingRule);
assistantRoutes.delete('/:assistantId/rules/:ruleId', author, assistants.deleteRoutingRule);

assistantRoutes.get('/:assistantId/routing-conflicts', validateParams(assistantIdParam), assistants.getRoutingConflicts);
assistantRoutes.get('/:assistantId/candidates', validateParams(assistantIdParam), routing.getCandidates);

assistantRoutes.post('/:assistantId/route-test', validateParams(assistantIdParam), author, llmLimiter, validateBody(routeTestSchema), routing.routeTest);
assistantRoutes.get('/:assistantId/routing-tests', validateParams(assistantIdParam), routing.listRoutingTests);
assistantRoutes.post('/:assistantId/routing-tests', validateParams(assistantIdParam), author, validateBody(createRoutingTestSchema), routing.createRoutingTest);
assistantRoutes.delete('/:assistantId/routing-tests/:testId', author, routing.deleteRoutingTest);
assistantRoutes.post('/:assistantId/routing-tests/run', validateParams(assistantIdParam), author, suiteLimiter, routing.runRoutingTests);

assistantRoutes.get('/:assistantId/workflows', validateParams(assistantIdParam), validateQuery(listWorkflowsQuery), workflows.listWorkflows);
assistantRoutes.post('/:assistantId/workflows', validateParams(assistantIdParam), author, validateBody(createWorkflowSchema), workflows.createWorkflow);
assistantRoutes.post('/:assistantId/workflows/from-template', validateParams(assistantIdParam), author, validateBody(createFromTemplateSchema), workflows.createFromTemplate);
// Generation costs a model call and produces a whole graph, so it sits behind
// the LLM limiter alongside route-test and the simulator.
assistantRoutes.post('/:assistantId/workflows/generate', validateParams(assistantIdParam), author, llmLimiter, workflows.generateWorkflowFromPrompt);

// The gallery is a read of a static registry, so it needs no assistant.
export const templateRoutes = Router();
templateRoutes.use(requireAuth);
templateRoutes.get('/', workflows.listTemplates);

// ── Workflows ─────────────────────────────────────────────────────────────────

export const engineWorkflowRoutes = Router();
engineWorkflowRoutes.use(requireAuth);

engineWorkflowRoutes.get('/:workflowId', validateParams(workflowIdParam), reader, workflows.getWorkflow);
engineWorkflowRoutes.patch('/:workflowId', validateParams(workflowIdParam), author, validateBody(updateWorkflowSchema), workflows.updateWorkflow);
engineWorkflowRoutes.delete('/:workflowId', validateParams(workflowIdParam), remover, workflows.deleteWorkflow);

engineWorkflowRoutes.get('/:workflowId/capability', validateParams(workflowIdParam), reader, workflows.getCapability);
engineWorkflowRoutes.put('/:workflowId/capability', validateParams(workflowIdParam), author, validateBody(putCapabilitySchema), workflows.putCapability);

engineWorkflowRoutes.get('/:workflowId/versions', validateParams(workflowIdParam), reader, workflows.listVersions);
engineWorkflowRoutes.post('/:workflowId/versions', validateParams(workflowIdParam), author, validateBody(createVersionSchema), workflows.createVersion);

engineWorkflowRoutes.post('/:workflowId/validate', validateParams(workflowIdParam), author, validateBody(validateWorkflowSchema), workflows.validateWorkflow);
engineWorkflowRoutes.post('/:workflowId/publish', validateParams(workflowIdParam), publisher, validateBody(publishWorkflowSchema), workflows.publishWorkflow);
engineWorkflowRoutes.post('/:workflowId/unpublish', validateParams(workflowIdParam), publisher, workflows.unpublishWorkflow);

engineWorkflowRoutes.post('/:workflowId/test', validateParams(workflowIdParam), author, llmLimiter, validateBody(testWorkflowSchema), instances.testWorkflow);

// ── Instances ─────────────────────────────────────────────────────────────────

export const instanceRoutes = Router();
instanceRoutes.use(requireAuth);

instanceRoutes.get('/', validateQuery(listInstancesQuery), instances.listInstances);
instanceRoutes.get('/:instanceId', instances.getInstance);
instanceRoutes.get('/:instanceId/executions', instances.getInstanceExecutions);
instanceRoutes.post('/:instanceId/cancel', author, validateBody(cancelInstanceSchema), instances.cancelInstanceHandler);

// ── Conversation control ──────────────────────────────────────────────────────

export const conversationEngineRoutes = Router();
conversationEngineRoutes.use(requireAuth);

conversationEngineRoutes.post('/:conversationId/handoff', automationToggler, validateBody(handoffSchema), instances.handoffConversation);
conversationEngineRoutes.post('/:conversationId/resume-bot', automationToggler, instances.resumeBot);
conversationEngineRoutes.post('/:conversationId/simulate', author, llmLimiter, validateBody(simulatorReplySchema), instances.simulatorReply);
conversationEngineRoutes.get('/:conversationId/routing-decisions', routing.listRoutingDecisions);

// ── Connectors ────────────────────────────────────────────────────────────────
//
// Authoring is OWNER/MANAGER; deleting is OWNER, because a connector is
// referenced by workflows and removing one breaks every graph that calls it.
// Testing an operation sits behind the LLM limiter's sibling reasoning: each
// call leaves this server and hits someone else's API on the tenant's behalf.

export const connectorRoutes = Router();
connectorRoutes.use(requireAuth);

// The operator's catalog of connector types, for the "New connector" picker. Ahead of
// `/:connectorId`, or Express reads "types" as a connector id and 404s it.
const connectorReader = requirePermission('connectors:read');
connectorRoutes.get('/types', connectorReader, connectors.listConnectorTypes);

// `connectors:read` on the reads.
//
// It was in the permission vocabulary from the start but never passed to
// `requirePermission`, so these two were open to any authenticated user of the workspace —
// including a custom role built specifically to keep someone away from the integrations.
// A connector row carries a base URL and a credential hint, which is enough to tell you
// which systems a business is wired into.
connectorRoutes.get('/', connectorReader, connectors.listConnectors);
connectorRoutes.post('/', connectorAuthor, connectors.createConnector);
connectorRoutes.get('/:connectorId', connectorReader, connectors.getConnector);
connectorRoutes.patch('/:connectorId', connectorAuthor, connectors.updateConnector);
// Its own grant: deleting a connector breaks every workflow that calls it, which
// is a different risk from publishing one.
connectorRoutes.delete('/:connectorId', requirePermission('connectors:delete'), connectors.deleteConnector);

connectorRoutes.post('/:connectorId/operations', connectorAuthor, connectors.createOperation);
connectorRoutes.patch('/:connectorId/operations/:operationId', connectorAuthor, connectors.updateOperation);
connectorRoutes.delete('/:connectorId/operations/:operationId', connectorAuthor, connectors.deleteOperation);
connectorRoutes.post('/:connectorId/operations/:operationId/test', connectorAuthor, llmLimiter, connectors.testOperation);
