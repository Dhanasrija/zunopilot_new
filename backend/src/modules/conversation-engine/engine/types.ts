import type { Conversation, Customer, Tenant, WhatsappAccount } from '@prisma/client';
import type { ContextLogger } from '../../../config/logger.js';
import type { WorkflowNode } from '../domain/definition.js';
import type { NodeType } from '../domain/node-types.js';

// The node execution contract.
//
// Two rules hold every executor in shape:
//
//   1. An executor never chooses the next node. It returns a *handle* name and
//      the walker resolves that against the graph's edges. Control flow is a
//      property of the graph, not of any node's code.
//   2. An executor never writes to the WorkflowInstance. It returns a
//      `variablesPatch` and the walker persists it, so one node's crash cannot
//      leave the instance half-updated.
//
// Adding a node type means adding one file that exports a WorkflowNodeExecutor
// and registering it — no change to the walker.

/** Anything a node might need from the outside world, injected not imported. */
export interface NodeServices {
  whatsapp: WhatsAppSender;
  llm: LlmCompleter;
  http: HttpCaller;
  /** Named mock integrations, used by seeded demo workflows and tests. */
  integrations: Record<string, MockIntegration>;
}

export interface WhatsAppSender {
  sendText(args: { to: string; body: string }): Promise<{ messageId: string | null }>;
  sendButtons(args: {
    to: string;
    body: string;
    buttons: Array<{ id: string; title: string }>;
  }): Promise<{ messageId: string | null }>;
  sendList(args: {
    to: string;
    body: string;
    button: string;
    sections: Array<{ title?: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  }): Promise<{ messageId: string | null }>;
  sendTemplate(args: {
    to: string;
    templateName: string;
    language: string;
    params: string[];
    /**
     * Media for the template's header, when the approved template declares one.
     *
     * Optional because most templates have no header, or a text one. When a template *does*
     * declare an IMAGE/VIDEO/DOCUMENT header, Meta refuses the message without this — so
     * omitting it is not a degraded send, it is a failed one. `link` is fetched by Meta from
     * its own servers, which is why the media route is public.
     */
    headerMedia?: { kind: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; link: string; filename?: string };
  }): Promise<{ messageId: string | null }>;
}

export interface LlmCompleter {
  complete(args: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{ text: string; tokenUsage?: Record<string, number>; model?: string }>;
}

export interface HttpCaller {
  request(args: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  }): Promise<{ status: number; body: unknown; ok: boolean }>;
}

export interface MockIntegration {
  name: string;
  call(input: Record<string, unknown>): Promise<unknown>;
}

/** The read-only view a node's templates can address. */
export interface TemplateScope {
  tenant: { name: string; category: string };
  customer: { name: string; waId: string; phone: string };
  conversation: { id: string; status: string };
  message: { text: string; type: string };
  vars: Record<string, unknown>;
  now: { iso: string; date: string; time: string; timezone: string };
}

export interface NodeExecutionContext<TConfig = unknown> {
  tenantId: string;
  assistantId: string | null;
  conversationId: string;
  workflowInstanceId: string;
  nodeExecutionId: string;

  node: WorkflowNode;
  /** Already validated against the node type's schema and interpolated. */
  config: TConfig;

  variables: Record<string, unknown>;
  scope: TemplateScope;

  tenant: Tenant;
  contact: Customer;
  conversation: Conversation;
  channel: WhatsappAccount;
  /** The message that triggered this run, or the answer that resumed it. */
  latestMessage: { id: string; body: string; type: string; payload: unknown } | null;

  services: NodeServices;
  logger: ContextLogger;
  abortSignal: AbortSignal;

  /**
   * Stable per-node key for external side effects. Replaying a node whose key
   * already succeeded returns the recorded output instead of acting twice.
   */
  idempotencyKey: string;

  /** True when the run must not perform external side effects (simulator). */
  dryRun: boolean;
}

export type NodeExecutionStatusResult =
  | 'SUCCESS'
  | 'WAITING_FOR_USER'
  | 'WAITING'
  | 'FAILED'
  | 'HUMAN_HANDOFF';

export interface NodeExecutionResult<TOutput = unknown> {
  status: NodeExecutionStatusResult;
  output?: TOutput;
  /** Merged into instance variables by the walker, never written directly. */
  variablesPatch?: Record<string, unknown>;
  /** Which outgoing edge to take. Null means the unlabelled default. */
  nextHandle?: string | null;
  /** Set with status WAITING — the walker parks the instance until then. */
  waitUntil?: Date | null;
  /** Set with WAITING_FOR_USER — what the run is waiting for. */
  awaiting?: {
    nodeId: string;
    variableName: string;
  } | null;
  error?: { message: string; code?: string; retryable?: boolean } | null;
  /** Set by END_WORKFLOW to stop the walk with a specific outcome. */
  terminal?: 'COMPLETED' | 'CANCELLED' | null;
}

/** What the customer sent back to a node that was waiting. */
export interface InboundReply {
  /** Message text, or the title of the row/button they tapped. */
  text: string;
  /** The id of the tapped row or button, when it was a tap rather than typing. */
  replyId: string | null;
}

export type ReplyOutcome =
  /** Accepted. `value` is stored in the node's variable and the walk continues. */
  | { ok: true; value: unknown; extraVariables?: Record<string, unknown> }
  /** Rejected. The node re-prompts, up to its retry limit. */
  | { ok: false; reason: string };

export interface WorkflowNodeExecutor<TConfig = unknown, TOutput = unknown> {
  type: NodeType;

  /** Parse the node's raw config. Throws (ZodError) if the node is misconfigured. */
  validateConfig(config: unknown): TConfig;

  execute(context: NodeExecutionContext<TConfig>): Promise<NodeExecutionResult<TOutput>>;

  /**
   * Validate the reply to a node that returned WAITING_FOR_USER.
   *
   * Only present on nodes that park. Its presence is what makes a node type
   * "waiting-capable" — the resume path dispatches on this rather than on a
   * hardcoded list of types, so adding an interactive node type needs no change
   * to the resume logic.
   */
  acceptReply?(args: {
    config: TConfig;
    reply: InboundReply;
    variables: Record<string, unknown>;
  }): ReplyOutcome | Promise<ReplyOutcome>;

  /** The prompt to re-send when `acceptReply` rejects. */
  retryPrompt?(config: TConfig): string | null;
}

/** Thrown by an executor when the failure is worth retrying (timeout, 5xx). */
export class RetryableNodeError extends Error {
  readonly retryable = true;
  readonly code: string;

  constructor(message: string, code = 'RETRYABLE') {
    super(message);
    this.name = 'RetryableNodeError';
    this.code = code;
  }
}

/** Thrown when a node is misconfigured — retrying cannot help. */
export class NodeConfigError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'NodeConfigError';
  }
}
