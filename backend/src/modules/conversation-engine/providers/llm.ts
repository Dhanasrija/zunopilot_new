import OpenAI from 'openai';
import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import type { LlmCompleter } from '../engine/types.js';

// LLM provider abstraction.
//
// One interface, two implementations, chosen by env. The engine and the router
// only ever see this interface, so replacing OpenAI is a new class rather than
// a search-and-replace — and the routing suite runs against the mock with no
// key, no network and no cost.

export interface StructuredRequest {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  /**
   * Per-request timeout, overriding the client default.
   *
   * The client default is deliberately short because the router runs while a
   * customer is staring at a delivered tick. Authoring-time work — generating a
   * whole workflow — is a person clicking a button and willing to wait, and
   * inheriting the router's budget just makes it fail.
   */
  timeoutMs?: number;
}

export interface StructuredResponse {
  /** Parsed JSON. Never a string — callers must not parse model prose. */
  data: unknown;
  model: string;
  tokenUsage: Record<string, number>;
  latencyMs: number;
}

export interface LLMProvider extends LlmCompleter {
  readonly name: string;
  /** Constrained generation. Throws if the provider cannot honour the schema. */
  completeStructured(request: StructuredRequest): Promise<StructuredResponse>;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(apiKey: string = env.openai.apiKey) {
    this.client = new OpenAI({
      apiKey,
      // A customer is waiting on WhatsApp. Fail fast and let the caller fall
      // back rather than leaving them staring at a delivered tick.
      timeout: env.openai.timeoutMs,
      maxRetries: 1,
    });
  }

  async complete({ systemPrompt, userPrompt, maxTokens, temperature }: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
  }) {
    const completion = await this.client.chat.completions.create({
      model: env.openai.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    });

    return {
      text: completion.choices[0]?.message?.content ?? '',
      model: completion.model,
      tokenUsage: {
        prompt: completion.usage?.prompt_tokens ?? 0,
        completion: completion.usage?.completion_tokens ?? 0,
        total: completion.usage?.total_tokens ?? 0,
      },
    };
  }

  async completeStructured(request: StructuredRequest): Promise<StructuredResponse> {
    const startedAt = Date.now();

    const completion = await this.client.chat.completions.create({
      model: env.openai.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      // Constrained decoding, not "please return JSON". The model physically
      // cannot emit a shape that fails the schema, which is what makes it safe
      // to route on the result instead of parsing prose.
      response_format: {
        type: 'json_schema',
        json_schema: { name: request.schemaName, strict: true, schema: request.jsonSchema },
      },
      // Routing should be reproducible: the same message with the same
      // capability contracts should not route differently run to run.
      temperature: request.temperature ?? 0,
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
    }, request.timeoutMs ? { timeout: request.timeoutMs } : undefined);

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('Model returned no content for a structured request');

    return {
      data: JSON.parse(content) as unknown,
      model: completion.model,
      tokenUsage: {
        prompt: completion.usage?.prompt_tokens ?? 0,
        completion: completion.usage?.completion_tokens ?? 0,
        total: completion.usage?.total_tokens ?? 0,
      },
      latencyMs: Date.now() - startedAt,
    };
  }
}

// ── Mock ──────────────────────────────────────────────────────────────────────

export interface MockRoutingRule {
  match: RegExp;
  respond: (candidateSlugs: string[]) => Record<string, unknown> | null;
}

/**
 * A deterministic stand-in for the router.
 *
 * It scores the message against the same capability signal the real model is
 * given — the positive and negative examples — rather than hard-coding answers.
 * That keeps the routing suite honest: a test passes because the capability
 * contract distinguishes the workflows, which is the thing actually under test,
 * not because the mock was told the answer.
 */
export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock';
  readonly structuredCalls: StructuredRequest[] = [];

  constructor(private readonly overrides: MockRoutingRule[] = []) {}

  async complete({ userPrompt }: { systemPrompt: string; userPrompt: string }) {
    return {
      text: `Mock reply to: ${userPrompt.slice(0, 60)}`,
      model: 'mock-llm',
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
    };
  }

  async completeStructured(request: StructuredRequest): Promise<StructuredResponse> {
    this.structuredCalls.push(request);
    const startedAt = Date.now();

    const message = this.extractMessage(request.userPrompt);
    const workflows = this.extractWorkflows(request.userPrompt);
    const slugs = workflows.map((w) => w.workflowId);

    for (const override of this.overrides) {
      if (override.match.test(message)) {
        const data = override.respond(slugs);
        if (data) return { data, model: 'mock-llm', tokenUsage: {}, latencyMs: Date.now() - startedAt };
      }
    }

    return {
      data: this.decide(message, workflows),
      model: 'mock-llm',
      tokenUsage: { prompt: 0, completion: 0, total: 0 },
      latencyMs: Date.now() - startedAt,
    };
  }

  private extractMessage(userPrompt: string): string {
    const match = userPrompt.match(
      /--- BEGIN UNTRUSTED USER MESSAGE ---\n([\s\S]*?)\n--- END UNTRUSTED USER MESSAGE ---/,
    );
    return (match?.[1] ?? userPrompt).trim().toLowerCase();
  }

  private extractWorkflows(userPrompt: string): Array<{
    workflowId: string;
    positiveExamples: string[];
    negativeExamples: string[];
    useWhen: string[];
    doNotUseWhen: string[];
    priority: number;
  }> {
    const jsonEnd = userPrompt.indexOf('--- BEGIN UNTRUSTED USER MESSAGE ---');
    try {
      const parsed = JSON.parse(userPrompt.slice(0, jsonEnd).trim()) as {
        availableWorkflows?: Array<Record<string, unknown>>;
      };
      return (parsed.availableWorkflows ?? []).map((w) => ({
        workflowId: String(w.workflowId ?? ''),
        positiveExamples: (w.positiveExamples as string[]) ?? [],
        negativeExamples: (w.negativeExamples as string[]) ?? [],
        useWhen: (w.useWhen as string[]) ?? [],
        doNotUseWhen: (w.doNotUseWhen as string[]) ?? [],
        priority: Number(w.priority ?? 50),
      }));
    } catch {
      return [];
    }
  }

  /** Best bag-of-words overlap between the message and any of `examples`. */
  private score(message: string, examples: string[]): number {
    const words = new Set(message.split(/\W+/).filter((w) => w.length > 3));
    if (!words.size) return 0;

    let best = 0;
    for (const example of examples) {
      const exampleWords = example.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      if (!exampleWords.length) continue;
      const overlap = exampleWords.filter((w) => words.has(w)).length;
      best = Math.max(best, overlap / exampleWords.length);
    }
    return best;
  }

  private decide(
    message: string,
    workflows: ReturnType<MockLLMProvider['extractWorkflows']>,
  ): Record<string, unknown> {
    const base = {
      workflowId: null as string | null,
      confidence: 0,
      extractedInputs: [] as Array<{ key: string; value: string }>,
      missingInputs: [] as string[],
      clarificationQuestion: null as string | null,
      possibleWorkflowIds: [] as string[],
    };

    if (/\b(human|agent|person|manager|representative|someone real)\b/.test(message)) {
      return { ...base, decision: 'HUMAN_HANDOFF', reasonCode: 'USER_REQUESTED_HUMAN', confidence: 0.95 };
    }

    if (!workflows.length) {
      return { ...base, decision: 'NO_MATCH', reasonCode: 'NO_SUITABLE_WORKFLOW' };
    }

    const scored = workflows
      .map((w) => {
        const positive = this.score(message, [...w.positiveExamples, ...w.useWhen]);
        const negative = this.score(message, [...w.negativeExamples, ...w.doNotUseWhen]);
        // Resembling a counter-example more than an example is disqualifying —
        // this is what keeps "is Dr Rao available tomorrow?" away from booking.
        // Below that, a partial negative only discounts, because one shared
        // word ("tomorrow") appearing in both lists should not veto a match.
        const score = negative > positive ? 0 : Math.max(0, positive - negative * 0.5);
        return { workflow: w, score };
      })
      .sort((a, b) => b.score - a.score || b.workflow.priority - a.workflow.priority);

    const [top, runnerUp] = scored;
    // A weak best match is no match. Without this floor, one incidental shared
    // word makes an unrelated question look like a routable intent.
    if (!top || top.score < 0.35) {
      return { ...base, decision: 'NO_MATCH', reasonCode: 'NO_SUITABLE_WORKFLOW' };
    }

    const margin = top.score - (runnerUp?.score ?? 0);
    const confidence = Math.min(0.99, Math.round((0.5 + top.score * 0.5) * 100) / 100);

    if (runnerUp && runnerUp.score > 0 && margin < 0.15) {
      return {
        ...base,
        decision: 'ASK_CLARIFICATION',
        reasonCode: 'AMBIGUOUS_BETWEEN_WORKFLOWS',
        confidence: Math.min(confidence, 0.7),
        clarificationQuestion: 'Just to be sure — what would you like me to do?',
        possibleWorkflowIds: [top.workflow.workflowId, runnerUp.workflow.workflowId],
      };
    }

    return {
      ...base,
      decision: 'START_WORKFLOW',
      workflowId: top.workflow.workflowId,
      confidence,
      reasonCode: 'EXACT_INTENT_MATCH',
    };
  }
}

// ── Selection ─────────────────────────────────────────────────────────────────

let cached: LLMProvider | null = null;

export const llmProvider = (): LLMProvider => {
  if (cached) return cached;

  const kind = env.engine.llmProvider;
  if (kind === 'openai' && env.openai.apiKey) {
    cached = new OpenAIProvider();
  } else {
    if (kind === 'openai') {
      logger.warn('LLM_PROVIDER=openai but OPENAI_API_KEY is unset — using the mock router');
    }
    cached = new MockLLMProvider();
  }

  logger.info('LLM provider selected', { provider: cached.name });
  return cached;
};

export const setLlmProvider = (provider: LLMProvider | null): void => { cached = provider; };
