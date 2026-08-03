import { z } from 'zod';
import { NODE_CONFIG_SCHEMAS } from '../../domain/node-types.js';
import { NodeConfigError, RetryableNodeError, type WorkflowNodeExecutor } from '../types.js';

// Executors that reach outside the system.

type AiAgentConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.AI_AGENT>;
type HttpRequestConfig = z.infer<typeof NODE_CONFIG_SCHEMAS.HTTP_REQUEST>;

export const aiAgentExecutor: WorkflowNodeExecutor<AiAgentConfig, { reply: string; model?: string }> = {
  type: 'AI_AGENT',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.AI_AGENT.parse(config),
  execute: async ({ config, contact, services, dryRun, logger }) => {
    if (dryRun) {
      return {
        status: 'SUCCESS',
        output: { reply: '[dry run: AI reply suppressed]' },
        variablesPatch: { [config.outputVariable]: '[dry run]' },
      };
    }

    const completion = await services.llm.complete({
      // The customer's message is interpolated into userPrompt, never into the
      // system prompt — so a customer cannot rewrite the node's instructions by
      // typing them. The system prompt is entirely operator-authored.
      systemPrompt: config.systemPrompt,
      userPrompt: config.userPrompt,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    });

    const reply = completion.text.trim();
    if (config.sendToCustomer && reply) {
      await services.whatsapp.sendText({ to: contact.waId, body: reply });
    }

    logger.debug('AI agent completed', { model: completion.model });

    return {
      status: 'SUCCESS',
      output: { reply, ...(completion.model ? { model: completion.model } : {}) },
      variablesPatch: { [config.outputVariable]: reply },
    };
  },
};

/**
 * Call an external endpoint, or a named mock.
 *
 * Two things here are deliberate and load-bearing:
 *
 *   • `mockService` short-circuits the real call. Every seeded demo workflow
 *     uses it, so nothing shipped in the seed can reach the public internet.
 *   • Retries apply only to timeouts and 5xx. A 4xx means the request was wrong
 *     and repeating it will be wrong again — and if the endpoint is not
 *     idempotent, retrying a 4xx is how one booking becomes three.
 *
 * Real outbound HTTP to tenant-authored URLs is an SSRF surface. The egress
 * allowlist that gates it is designed in Phase 4; until then a node with no
 * `mockService` is rejected rather than dialled.
 */
export const httpRequestExecutor: WorkflowNodeExecutor<HttpRequestConfig, unknown> = {
  type: 'HTTP_REQUEST',
  validateConfig: (config) => NODE_CONFIG_SCHEMAS.HTTP_REQUEST.parse(config),
  execute: async ({ config, services, logger, dryRun }) => {
    if (config.mockService) {
      const integration = services.integrations[config.mockService];
      if (!integration) {
        throw new NodeConfigError(`Unknown mock service "${config.mockService}"`);
      }
      const result = await integration.call({
        method: config.method,
        url: config.url,
        query: config.query,
        body: config.body,
      });
      logger.debug('Mock integration called', { service: config.mockService });
      return {
        status: 'SUCCESS',
        output: result,
        variablesPatch: { [config.outputVariable]: result },
        nextHandle: 'success',
      };
    }

    if (dryRun) {
      return {
        status: 'SUCCESS',
        output: { dryRun: true },
        variablesPatch: { [config.outputVariable]: { dryRun: true } },
        nextHandle: 'success',
      };
    }

    // Egress guard. Until the allowlist lands, arbitrary tenant-authored URLs
    // are refused outright rather than dialled — this is the SSRF surface, and
    // "we'll add the check later" is how it ships open.
    throw new NodeConfigError(
      'Outbound HTTP to arbitrary URLs is not enabled yet. Set `mockService` on this node, '
      + 'or wait for the egress allowlist.',
    );
  },
};

/**
 * Classify an HTTP failure. Exported so the walker's retry policy and the
 * executor agree on what "retryable" means.
 */
export const isRetryableHttpFailure = (status: number): boolean =>
  status === 0 || status === 408 || status === 429 || status >= 500;

export const httpFailure = (status: number, url: string): Error => {
  const message = `HTTP ${status} from ${url}`;
  return isRetryableHttpFailure(status)
    ? new RetryableNodeError(message, `HTTP_${status}`)
    : new NodeConfigError(message);
};
