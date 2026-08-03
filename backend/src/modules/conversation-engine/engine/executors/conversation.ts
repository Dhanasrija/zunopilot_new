import { z } from 'zod';
import { NODE_CONFIG_SCHEMAS } from '../../domain/node-types.js';
import { NodeConfigError, type NodeExecutionResult, type WorkflowNodeExecutor } from '../types.js';

// Executors that talk to the customer.

type AssistantRouteEntryConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.ASSISTANT_ROUTE_ENTRY>;
type SendMessageConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.SEND_WHATSAPP_MESSAGE>;
type AskUserInputConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.ASK_USER_INPUT>;
type HumanHandoffConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.HUMAN_HANDOFF>;

/**
 * The entry point of every conversation workflow.
 *
 * It executes as a no-op — by the time the walker reaches it the router has
 * already decided, and the inputs it extracted are already in the instance's
 * variables. It exists as a node so the canvas can show where a run starts and
 * what the router is allowed to hand over, rather than pretending a generic
 * "WhatsApp trigger" fires the flow.
 */
export const assistantRouteEntryExecutor: WorkflowNodeExecutor<AssistantRouteEntryConfig, { enteredAt: string }> = {
  type: 'ASSISTANT_ROUTE_ENTRY',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.ASSISTANT_ROUTE_ENTRY.parse(config),
  execute: async ({ logger, variables }) => {
    logger.debug('Workflow entered via assistant router', {
      variableKeys: Object.keys(variables),
    });
    return { status: 'SUCCESS', output: { enteredAt: new Date().toISOString() } };
  },
};

export const sendWhatsAppMessageExecutor: WorkflowNodeExecutor<SendMessageConfig, { messageId: string | null }> = {
  type: 'SEND_WHATSAPP_MESSAGE',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.SEND_WHATSAPP_MESSAGE.parse(config),
  execute: async ({ config, contact, services, dryRun, logger }) => {
    const body = config.body.trim();
    if (!body) throw new NodeConfigError('Send WhatsApp node resolved to an empty message');

    if (dryRun) {
      logger.info('Dry run: suppressed outbound message');
      return { status: 'SUCCESS', output: { messageId: null } };
    }

    const sent = await services.whatsapp.sendText({ to: contact.waId, body });
    return { status: 'SUCCESS', output: { messageId: sent.messageId } };
  },
};

/**
 * Ask a question and stop.
 *
 * This is the node that makes a workflow conversational rather than a script:
 * it sends the prompt, parks the instance in WAITING_FOR_USER, and records
 * which variable the next inbound message should fill. Nothing else runs until
 * that message arrives — which is also why the walker must persist the awaiting
 * node *before* returning, or an answer arriving milliseconds later has nowhere
 * to go.
 */
export const askUserInputExecutor: WorkflowNodeExecutor<AskUserInputConfig, { prompt: string; asked: boolean }> = {
  type: 'ASK_USER_INPUT',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.ASK_USER_INPUT.parse(config),

  // Same contract as the interactive nodes, so the resume path has one branch
  // rather than a special case per node type.
  acceptReply: ({ config, reply }) => {
    const result = validateUserAnswer(config, reply.text);
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, reason: result.reason };
  },

  retryPrompt: (config) => config.retryMessage ?? config.prompt,
  execute: async ({ config, node, contact, services, dryRun }) => {
    if (!dryRun) {
      await services.whatsapp.sendText({ to: contact.waId, body: config.prompt });
    }
    return {
      status: 'WAITING_FOR_USER',
      output: { prompt: config.prompt, asked: true },
      awaiting: { nodeId: node.id, variableName: config.variableName },
    };
  },
};

/**
 * Validate an answer against an ASK_USER_INPUT node's rules.
 *
 * Lives beside the executor rather than in the walker because the rules belong
 * to the node type. Returns the coerced value, or the reason it was rejected.
 */
export const validateUserAnswer = (
  config: AskUserInputConfig,
  raw: string,
): { ok: true; value: string | number } | { ok: false; reason: string } => {
  const trimmed = raw.trim();

  if (!trimmed) {
    return config.required
      ? { ok: false, reason: 'Answer was empty' }
      : { ok: true, value: '' };
  }

  const rules = config.validation;

  switch (config.inputType) {
    case 'number': {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) return { ok: false, reason: 'Not a number' };
      if (rules.min !== undefined && parsed < rules.min) return { ok: false, reason: `Below minimum ${rules.min}` };
      if (rules.max !== undefined && parsed > rules.max) return { ok: false, reason: `Above maximum ${rules.max}` };
      return { ok: true, value: parsed };
    }
    case 'date': {
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) return { ok: false, reason: 'Not a recognisable date' };
      // Normalise to ISO date so downstream nodes and mock APIs get one format.
      return { ok: true, value: parsed.toISOString().slice(0, 10) };
    }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
        ? { ok: true, value: trimmed }
        : { ok: false, reason: 'Not a valid email address' };
    case 'phone': {
      const digits = trimmed.replace(/\D/g, '');
      return digits.length >= 7
        ? { ok: true, value: digits }
        : { ok: false, reason: 'Not a valid phone number' };
    }
    case 'choice': {
      const choices = rules.choices ?? [];
      const match = choices.find((c) => c.toLowerCase() === trimmed.toLowerCase());
      return match
        ? { ok: true, value: match }
        : { ok: false, reason: `Must be one of: ${choices.join(', ')}` };
    }
    default: {
      if (rules.minLength !== undefined && trimmed.length < rules.minLength) {
        return { ok: false, reason: `Must be at least ${rules.minLength} characters` };
      }
      if (rules.maxLength !== undefined && trimmed.length > rules.maxLength) {
        return { ok: false, reason: `Must be at most ${rules.maxLength} characters` };
      }
      if (rules.pattern) {
        // A tenant-authored pattern is untrusted input. Anchoring and a length
        // cap keep a catastrophically backtracking regex from stalling a worker.
        try {
          if (!new RegExp(rules.pattern).test(trimmed.slice(0, 500))) {
            return { ok: false, reason: 'Did not match the expected format' };
          }
        } catch {
          return { ok: true, value: trimmed }; // bad pattern: don't block the customer
        }
      }
      return { ok: true, value: trimmed };
    }
  }
};

export const humanHandoffExecutor: WorkflowNodeExecutor<HumanHandoffConfig, { reason: string }> = {
  type: 'HUMAN_HANDOFF',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.HUMAN_HANDOFF.parse(config),
  execute: async ({ config, contact, services, dryRun }): Promise<NodeExecutionResult<{ reason: string }>> => {
    if (!dryRun && config.message) {
      await services.whatsapp.sendText({ to: contact.waId, body: config.message });
    }
    // The walker performs the state change (conversation → HUMAN_TAKEOVER,
    // instance → PAUSED, HumanHandoff row) in one transaction. The executor only
    // reports what should happen, so a partial handoff is impossible.
    return { status: 'HUMAN_HANDOFF', output: { reason: config.reason } };
  },
};
