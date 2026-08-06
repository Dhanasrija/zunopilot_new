import type { NodeType } from '../../domain/node-types.js';
import type { WorkflowNodeExecutor } from '../types.js';
import {
  askUserInputExecutor,
  assistantRouteEntryExecutor,
  humanHandoffExecutor,
  sendWhatsAppMessageExecutor,
} from './conversation.js';
import {
  conditionExecutor,
  delayExecutor,
  endWorkflowExecutor,
  setVariableExecutor,
} from './logic.js';
import { aiAgentExecutor, httpRequestExecutor } from './integration.js';
import { startOrderingExecutor } from './ordering.js';
import { buttonMessageExecutor, listMessageExecutor } from './interactive.js';
import { cartAddItemExecutor, cartSummaryExecutor, createOrderExecutor } from './cart.js';
import { connectorActionExecutor, connectorQueryExecutor } from './connector.js';
import { databaseLookupExecutor, databaseWriteExecutor } from './database.js';

// The executor registry — the extension point for new node types.
//
// Adding a node type is: write the config schema in domain/node-types.ts, write
// a file exporting a WorkflowNodeExecutor, add one line here. The walker never
// changes.
//
// A type in NODE_TYPES but absent here is a palette entry with no runtime. The
// walker skips it and carries on rather than failing the run, and the publish
// validator warns — so one unbuilt node cannot break an otherwise valid flow,
// but nobody publishes one by accident either.

const EXECUTOR_LIST: WorkflowNodeExecutor<any, any>[] = [
  assistantRouteEntryExecutor,
  sendWhatsAppMessageExecutor,
  askUserInputExecutor,
  humanHandoffExecutor,
  conditionExecutor,
  setVariableExecutor,
  delayExecutor,
  endWorkflowExecutor,
  aiAgentExecutor,
  httpRequestExecutor,
  startOrderingExecutor,
  listMessageExecutor,
  buttonMessageExecutor,
  cartAddItemExecutor,
  cartSummaryExecutor,
  createOrderExecutor,
  connectorQueryExecutor,
  connectorActionExecutor,
  databaseLookupExecutor,
  databaseWriteExecutor,
];

export const EXECUTORS = new Map<NodeType, WorkflowNodeExecutor<any, any>>(
  EXECUTOR_LIST.map((executor) => [executor.type, executor]),
);

export const executorFor = (type: NodeType): WorkflowNodeExecutor<any, any> | null =>
  EXECUTORS.get(type) ?? null;

export const isImplemented = (type: NodeType): boolean => EXECUTORS.has(type);

/** Node types with a runtime, for the publish validator and the palette. */
export const IMPLEMENTED_NODE_TYPES: NodeType[] = [...EXECUTORS.keys()];

/** Node types that park for a reply — anything implementing `acceptReply`. */
export const isWaitingCapable = (type: NodeType): boolean =>
  typeof EXECUTORS.get(type)?.acceptReply === 'function';

export { validateUserAnswer } from './conversation.js';
export { compare } from './logic.js';
