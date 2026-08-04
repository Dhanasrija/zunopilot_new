import { api } from '@/lib/api';
import type { WorkflowDefinition } from './types';

// Typed client for the conversation-engine API.
//
// Everything unwraps the `{ success, data }` envelope so callers deal in domain
// objects, and every call is a plain function so TanStack Query owns caching
// rather than a bespoke layer.

const unwrap = <T>(promise: Promise<{ data: { data: T } }>): Promise<T> =>
  promise.then((r) => r.data.data);

// ── Shared shapes ─────────────────────────────────────────────────────────────

export type WorkflowStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type WorkflowCategory = 'CONVERSATION' | 'EVENT';
export type AssistantStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED';

export interface CapabilityInput {
  key: string;
  label: string;
  type: string;
  description?: string;
}

export interface CapabilityContract {
  purpose: string;
  description?: string | null;
  useWhen: string[];
  doNotUseWhen: string[];
  positiveExamples: string[];
  negativeExamples: string[];
  requiredInputs: CapabilityInput[];
  optionalInputs: CapabilityInput[];
  preconditions: string[];
  sideEffects: string[];
  requiresConfirmation: boolean;
  minimumConfidence: number;
  allowsInterruption: boolean;
}

export interface AssistantSummary {
  id: string;
  name: string;
  description: string | null;
  status: AssistantStatus;
  whatsappChannel: { displayPhone: string | null; phoneNumberId: string };
  _count: { workflows: number; conversations: number };
}

export interface RoutingWorkflowCard {
  id: string;
  name: string;
  slug: string | null;
  status: WorkflowStatus;
  category: WorkflowCategory;
  priority: number;
  purpose: string | null;
  requiresConfirmation: boolean;
  minimumConfidence: number | null;
  allowsInterruption: boolean;
  sideEffects: string[];
  requiredInputs: CapabilityInput[];
  exampleCount: { positive: number; negative: number };
  totalRuns: number;
  routable: boolean;
}

export interface RoutingRule {
  id: string;
  name: string;
  type: 'BUTTON_PAYLOAD' | 'LIST_PAYLOAD' | 'KEYWORD' | 'CUSTOMER_TAG' | 'BUSINESS_HOURS' | 'CRM_STATE' | 'COMMAND';
  configuration: Record<string, unknown>;
  workflowId: string | null;
  priority: number;
  enabled: boolean;
}

export interface RoutingConfig {
  assistant: {
    id: string;
    name: string;
    status: AssistantStatus;
    channel: { displayPhone: string | null; phoneNumberId: string };
    generalResponseEnabled: boolean;
    generalSystemPrompt: string | null;
    highConfidenceThreshold: number;
    mediumConfidenceThreshold: number;
    maxRecentMessages: number;
    defaultFallbackWorkflowId: string | null;
    humanHandoffWorkflowId: string | null;
  };
  workflows: RoutingWorkflowCard[];
  rules: RoutingRule[];
}

export interface WorkflowListItem {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  category: WorkflowCategory;
  status: WorkflowStatus;
  priority: number;
  purpose: string | null;
  hasCapability: boolean;
  publishedVersion: { id: string; version: number; publishedAt: string | null } | null;
  versionCount: number;
  totalRuns: number;
  updatedAt: string;
  completed: number;
  failed: number;
  active: number;
  successRate: number | null;
}

export interface WorkflowDetail {
  id: string;
  tenantId: string;
  assistantId: string | null;
  name: string;
  slug: string | null;
  description: string | null;
  category: WorkflowCategory;
  status: WorkflowStatus;
  priority: number;
  capability: (CapabilityContract & { id: string }) | null;
  publishedVersion: { id: string; version: number; definition: WorkflowDefinition } | null;
  versions: Array<{ id: string; version: number; definition: WorkflowDefinition; createdAt: string; publishedAt: string | null }>;
}

export interface ValidationIssue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface NodeExecution {
  id: string;
  nodeId: string;
  nodeType: string;
  status: 'PENDING' | 'RUNNING' | 'WAITING' | 'SUCCESS' | 'FAILED' | 'SKIPPED';
  attempt: number;
  input: unknown;
  output: unknown;
  error: unknown;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export interface OutboundMessage {
  to: string;
  kind: string;
  body: string;
}

export interface TestRunResult {
  instanceId: string;
  conversationId: string;
  status: string;
  variables: Record<string, unknown>;
  error: string | null;
  dryRun: boolean;
  outboundMessages: OutboundMessage[];
  executions: NodeExecution[];
}

export interface SimulateResult {
  outcome: 'CONTINUED' | 'REPROMPTED' | 'HANDED_OFF' | 'NOT_WAITING';
  validationError: string | null;
  status: string;
  variables: Record<string, unknown>;
  outboundMessages: OutboundMessage[];
  executions: NodeExecution[];
}

export interface RouteTestResult {
  source: 'ACTIVE_WORKFLOW' | 'DETERMINISTIC' | 'AI_ROUTER' | 'FALLBACK';
  decision: string;
  workflow: { id: string; name: string; slug: string | null } | null;
  confidence: number;
  reasonCode: string;
  extractedInputs: Record<string, string>;
  missingInputs: string[];
  clarificationQuestion: string | null;
  candidates: string[];
  latencyMs: number;
  model: string | null;
}

export interface RoutingConflict {
  workflows: Array<{ workflowId: string; name: string; hasSideEffects: boolean; guardsTheOther: boolean }>;
  similarity: number;
  severity: 'low' | 'medium' | 'high';
  detectedBy: 'similar-examples' | 'declared-counter-example';
  suggestion: string;
  warning?: string;
}

export interface RoutingTestCase {
  id: string;
  message: string;
  expectedDecision: string;
  expectedWorkflowId: string | null;
  expectedWorkflow: { id: string; name: string; slug: string | null } | null;
  lastRunAt: string | null;
  lastRunPassed: boolean | null;
  lastRunActual: Record<string, unknown> | null;
}

export interface SuiteRun {
  total: number;
  passed: number;
  failed: number;
  results: Array<{
    id: string;
    message: string;
    passed: boolean;
    expected: { decision: string; workflow: string | null };
    actual: { decision: string; workflow: string | null; confidence: number; reasonCode: string };
    latencyMs: number;
  }>;
}

// ── Calls ─────────────────────────────────────────────────────────────────────


// ── Connectors ────────────────────────────────────────────────────────────────

export interface ConnectorOperationInput {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  in: 'path' | 'query' | 'body' | 'header';
  description?: string;
}

export interface ConnectorOperation {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  method: string;
  path: string;
  inputs: ConnectorOperationInput[];
  responseMapping: {
    itemsPath?: string;
    idField?: string;
    titleField?: string;
    descriptionField?: string;
  };
  sideEffecting: boolean;
  timeoutMs?: number | null;
  sampleResponse?: unknown;
  /**
   * The request body to send, with `{placeholders}` filled from declared inputs.
   *
   * Null means the older behaviour: a flat object built from whichever inputs are declared
   * `in: 'body'`, which cannot express a nested payload or a constant field.
   */
  bodyTemplate?: unknown;
}

export type ConnectorKind = 'HTTP' | 'MOCK' | 'GOOGLE_SHEETS' | 'EMAIL';
export type ConnectorAuthType = 'NONE' | 'API_KEY_HEADER' | 'BEARER' | 'BASIC';

/**
 * One entry in the operator's catalog of connector types.
 *
 * A type says how to authenticate, never with what — the credential is the tenant's and is
 * supplied when they create the connector. That is why the whole row is safe to serve here.
 */
export interface ConnectorType {
  id: string;
  key: string;
  label: string;
  description?: string | null;
  kind: ConnectorKind;
  /** Which auth mechanisms this type accepts. Empty means offer them all. */
  allowedAuthTypes: ConnectorAuthType[];
  /** Prefilled and editable — the base URL stays the tenant's to set. */
  defaultBaseUrl?: string | null;
  secretLabel?: string | null;
  usernameLabel?: string | null;
  defaultHeader?: string | null;
  docsUrl?: string | null;
  /** Cloned into the tenant's connector on create, as a one-time snapshot. */
  operationTemplates: Array<{ key: string; name: string; method: string; sideEffecting: boolean }>;
}

export interface Connector {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  kind: ConnectorKind;
  /** Which catalog entry this came from, or null for one registered by hand. */
  connectorTypeId?: string | null;
  baseUrl?: string | null;
  authType: ConnectorAuthType;
  authConfig: { header?: string; username?: string };
  status: 'ACTIVE' | 'DISABLED';
  operations: ConnectorOperation[];
  /** Only ever a masked hint — the API never returns a credential. */
  secret?: { hint: string; updatedAt: string } | null;
}

export interface ConnectorListMeta {
  encryptionConfigured: boolean;
  mockConnectorKeys: string[];
}

// ── Templates ─────────────────────────────────────────────────────────────────

export interface WorkflowTemplateSummary {
  id: string;
  name: string;
  /**
   * A domain label for the gallery — "Ecommerce", "Support" and so on. Not the
   * workflow's CONVERSATION/EVENT category; every template is a conversation.
   */
  category: 'Ecommerce' | 'Lead generation' | 'Healthcare' | 'Support' | 'Feedback';
  tagline: string;
  description: string;
  /** Business categories this template is written for. Empty means any. */
  suitedTo: string[];
  suggestedSlug: string;
  nodeCount: number;
  hasSideEffects: boolean;
  /** Computed against the live executor registry, never declared. */
  available: boolean;
  missingRuntimes: string[];
}

export const engine = {
  assistants: {
    list: () => unwrap<AssistantSummary[]>(api.get('/assistants')),
    routing: (assistantId: string) =>
      unwrap<RoutingConfig>(api.get(`/assistants/${assistantId}/routing`)),
    updateRouting: (assistantId: string, body: Record<string, unknown>) =>
      unwrap<unknown>(api.patch(`/assistants/${assistantId}/routing`, body)),
    update: (assistantId: string, body: Record<string, unknown>) =>
      unwrap<unknown>(api.patch(`/assistants/${assistantId}`, body)),
    conflicts: (assistantId: string) =>
      api.get<{ data: { conflicts: RoutingConflict[]; checked: number } }>(
        `/assistants/${assistantId}/routing-conflicts`,
      ).then((r) => r.data.data),
  },

  templates: {
    /** Already sorted by relevance to this workspace's business category. */
    list: () => unwrap<WorkflowTemplateSummary[]>(api.get('/workflow-templates')),
  },

  connectors: {
    list: () => api.get<{ data: Connector[]; meta: ConnectorListMeta }>('/connectors')
      .then((r) => ({ connectors: r.data.data, meta: r.data.meta })),
    /** The operator's catalog, active entries only. Ordered for the picker. */
    types: () => unwrap<ConnectorType[]>(api.get('/connectors/types')),
    get: (connectorId: string) => unwrap<Connector>(api.get(`/connectors/${connectorId}`)),
    create: (body: Record<string, unknown>) => unwrap<Connector>(api.post('/connectors', body)),
    update: (connectorId: string, body: Record<string, unknown>) =>
      unwrap<Connector>(api.patch(`/connectors/${connectorId}`, body)),
    remove: (connectorId: string) => api.delete(`/connectors/${connectorId}`),
    createOperation: (connectorId: string, body: Record<string, unknown>) =>
      unwrap<ConnectorOperation>(api.post(`/connectors/${connectorId}/operations`, body)),
    updateOperation: (connectorId: string, operationId: string, body: Record<string, unknown>) =>
      unwrap<ConnectorOperation>(api.patch(`/connectors/${connectorId}/operations/${operationId}`, body)),
    removeOperation: (connectorId: string, operationId: string) =>
      api.delete(`/connectors/${connectorId}/operations/${operationId}`),
    testOperation: (connectorId: string, operationId: string, body: Record<string, unknown>) =>
      unwrap<Record<string, unknown>>(
        api.post(`/connectors/${connectorId}/operations/${operationId}/test`, body),
      ),
  },

  rules: {
    create: (assistantId: string, body: Record<string, unknown>) =>
      unwrap<RoutingRule>(api.post(`/assistants/${assistantId}/rules`, body)),
    update: (assistantId: string, ruleId: string, body: Record<string, unknown>) =>
      unwrap<RoutingRule>(api.patch(`/assistants/${assistantId}/rules/${ruleId}`, body)),
    remove: (assistantId: string, ruleId: string) =>
      api.delete(`/assistants/${assistantId}/rules/${ruleId}`),
  },

  workflows: {
    list: (assistantId: string, params?: Record<string, string>) =>
      unwrap<WorkflowListItem[]>(api.get(`/assistants/${assistantId}/workflows`, { params })),
    create: (assistantId: string, body: Record<string, unknown>) =>
      unwrap<{ id: string }>(api.post(`/assistants/${assistantId}/workflows`, body)),
    createFromTemplate: (assistantId: string, body: { templateId: string; name?: string; slug?: string }) =>
      unwrap<{ id: string; slug: string; name: string }>(
        api.post(`/assistants/${assistantId}/workflows/from-template`, body),
      ),
    get: (workflowId: string) => unwrap<WorkflowDetail>(api.get(`/workflows/${workflowId}`)),
    update: (workflowId: string, body: Record<string, unknown>) =>
      unwrap<unknown>(api.patch(`/workflows/${workflowId}`, body)),
    remove: (workflowId: string) => api.delete(`/workflows/${workflowId}`),
    putCapability: (workflowId: string, body: CapabilityContract) =>
      unwrap<unknown>(api.put(`/workflows/${workflowId}/capability`, body)),
    createVersion: (workflowId: string, definition: WorkflowDefinition) =>
      unwrap<{ id: string; version: number }>(api.post(`/workflows/${workflowId}/versions`, { definition })),
    validate: (workflowId: string, definition?: WorkflowDefinition) =>
      unwrap<{ valid: boolean; issues: ValidationIssue[] }>(
        api.post(`/workflows/${workflowId}/validate`, definition ? { definition } : {}),
      ),
    publish: (workflowId: string, versionId?: string) =>
      api.post(`/workflows/${workflowId}/publish`, versionId ? { versionId } : {}),
    unpublish: (workflowId: string) => api.post(`/workflows/${workflowId}/unpublish`),
    test: (workflowId: string, body: { message?: string; inputs?: Record<string, string>; dryRun?: boolean }) =>
      unwrap<TestRunResult>(api.post(`/workflows/${workflowId}/test`, body)),
  },

  routing: {
    test: (assistantId: string, message: string) =>
      unwrap<RouteTestResult>(api.post(`/assistants/${assistantId}/route-test`, { message })),
    listTests: (assistantId: string) =>
      unwrap<RoutingTestCase[]>(api.get(`/assistants/${assistantId}/routing-tests`)),
    createTest: (assistantId: string, body: Record<string, unknown>) =>
      unwrap<RoutingTestCase>(api.post(`/assistants/${assistantId}/routing-tests`, body)),
    removeTest: (assistantId: string, testId: string) =>
      api.delete(`/assistants/${assistantId}/routing-tests/${testId}`),
    runSuite: (assistantId: string) =>
      unwrap<SuiteRun>(api.post(`/assistants/${assistantId}/routing-tests/run`)),
  },

  instances: {
    executions: (instanceId: string) =>
      unwrap<{ instance: Record<string, unknown>; executions: NodeExecution[] }>(
        api.get(`/workflow-instances/${instanceId}/executions`),
      ),
    cancel: (instanceId: string, reason?: string) =>
      api.post(`/workflow-instances/${instanceId}/cancel`, { reason }),
  },

  conversations: {
    simulate: (conversationId: string, message: string, dryRun = true) =>
      unwrap<SimulateResult>(api.post(`/conversations/${conversationId}/simulate`, { message, dryRun })),
  },
};
