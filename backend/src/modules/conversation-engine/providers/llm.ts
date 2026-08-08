import OpenAI from 'openai';
import {
  LLM_VENDORS as LLM_VENDOR_KEYS, env, type LlmVendorKey, type VendorSettings,
} from '../../../config/env.js';
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

// ── OpenAI-compatible ─────────────────────────────────────────────────────────

/**
 * A readable name for whoever is actually serving the model.
 *
 * `name` used to be the literal `'openai'`. With `baseUrl` pointed at Groq or Google, that made
 * both the boot log and `RoutingDecision.model` claim OpenAI while somebody else answered —
 * which would make the whole point of a latency comparison unreadable.
 */
/**
 * Parse the reply, tolerating a code fence only where one is actually possible.
 *
 * Under strict `json_schema` the response is guaranteed to be bare JSON, so anything else is a
 * real fault and `JSON.parse` should say so. Under `json_object` the model was merely *asked* to
 * behave, and wrapping JSON in ```json fences despite being told not to is the single most common
 * way smaller models disobey. Stripping that is not papering over a bug — the content is correct
 * and the packaging is not.
 *
 * Nothing more forgiving than that. Hunting for the first `{` in a paragraph of prose would
 * quietly accept a model that ignored the instruction entirely, and the router is better off
 * treating that as no-match than routing a customer on a guess.
 */
const parseJsonReply = (content: string, strict: boolean): unknown => {
  if (strict) return JSON.parse(content) as unknown;
  const fenced = content.trim().match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  return JSON.parse(fenced ? fenced[1] : content) as unknown;
};

const providerNameFor = (baseUrl: string): string => {
  if (!baseUrl) return 'openai';
  try {
    return new URL(baseUrl).hostname.replace(/^api\./, '');
  } catch {
    return 'openai-compatible';
  }
};

/**
 * The box's own settings, as a `VendorSettings`.
 *
 * `env.llm` is the platform default — the vendor `LLM_VENDOR` names, or the unprefixed pair when it
 * names none — and this is that same block in the shape a provider instance takes. Kept as the
 * default constructor argument so every existing `new OpenAIProvider()` means exactly what it did.
 */
const platformSettings = (): VendorSettings => ({
  apiKey: env.llm.apiKey,
  model: env.llm.model,
  baseUrl: env.llm.baseUrl,
  structuredMode: env.llm.structuredMode,
  timeoutMs: env.llm.timeoutMs,
  extraBody: env.llm.extraBody,
});

export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  private readonly client: OpenAI;

  /**
   * The class keeps its name for history; it speaks to **any OpenAI-compatible endpoint**.
   *
   * Groq and Google both offer one, so switching vendor is `LLM_BASE_URL` plus `LLM_MODEL` and
   * no new adapter. The SDK has always supported `baseURL` — this code simply never passed it.
   */
  /**
   * The settings this instance answers with.
   *
   * **Held rather than read from `env` per call**, which is the change that made a per-workspace
   * vendor possible at all: two instances now coexist in one process, one per vendor, and a method
   * reaching for `env.llm.model` would give both of them whichever model the *box* defaults to.
   */
  private readonly settings: VendorSettings;

  constructor(settings: VendorSettings = platformSettings()) {
    this.settings = settings;
    this.name = providerNameFor(settings.baseUrl);
    this.client = new OpenAI({
      apiKey: settings.apiKey,
      ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
      // A customer is waiting on WhatsApp. Fail fast and let the caller fall
      // back rather than leaving them staring at a delivered tick.
      timeout: settings.timeoutMs,
      maxRetries: 1,
    });
  }

  /** The model this instance uses, for logs and for `RoutingDecision.model`. */
  get model(): string { return this.settings.model; }

  async complete({ systemPrompt, userPrompt, maxTokens, temperature }: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
  }) {
    const completion = await this.client.chat.completions.create({
      model: this.settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...this.settings.extraBody,
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);

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
    const strict = this.settings.structuredMode === 'json_schema';

    /*
     * Two ways to ask for JSON, because only one of them is portable.
     *
     * `json_schema` with `strict: true` is OpenAI's constrained decoding: the model *physically
     * cannot* emit a shape that fails the schema, which is what makes it safe to route on the
     * result instead of parsing prose. `routing/contract.ts` shapes the schema specifically for
     * it — closed objects, every property required.
     *
     * Support for that elsewhere is model-dependent, so `json_object` is the fallback: ask for
     * valid JSON and describe the shape in the prompt. Weaker, and honestly so — the model can
     * now return well-formed JSON of the wrong shape. That is survivable here and nowhere else:
     * `validateRouterOutput` already Zod-parses the reply, rejects a workflow id that was not
     * offered, and returns null on anything malformed, which the router turns into a general
     * response. The failure mode is a duller router, not a broken one, and it is visible as a
     * shift in `RoutingDecision.reasonCode`.
     *
     * The schema goes in the **system** prompt, alongside the operator-authored instructions,
     * never the user one — the user prompt carries the customer's own words, and a schema in
     * there is one more thing a customer could try to talk over.
     */
    const systemPrompt = strict
      ? request.systemPrompt
      : `${request.systemPrompt}\n\n`
        + 'Reply with JSON only — no prose, no code fences — matching this JSON Schema exactly:\n'
        + `${JSON.stringify(request.jsonSchema)}`;

    const completion = await this.client.chat.completions.create({
      model: this.settings.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      response_format: strict
        ? {
          type: 'json_schema',
          json_schema: { name: request.schemaName, strict: true, schema: request.jsonSchema },
        }
        : { type: 'json_object' },
      // Routing should be reproducible: the same message with the same
      // capability contracts should not route differently run to run.
      temperature: request.temperature ?? 0,
      ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
      // Vendor knobs; see `env.llm.extraBody`. Last, so they can override anything above.
      ...this.settings.extraBody,
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    request.timeoutMs ? { timeout: request.timeoutMs } : undefined);

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('Model returned no content for a structured request');

    return {
      data: parseJsonReply(content, strict),
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
//
// One provider per vendor, not one per process.
//
// This was a single `cached` instance, which was right while a box served one model. A workspace can
// now be pinned to a vendor in the operator console, so several coexist — and the cache is per vendor
// because an `OpenAI` client holds a connection pool worth reusing across the thousands of messages a
// busy workspace sends, but must not be shared between two different endpoints.

/** The platform default, i.e. what a workspace with no vendor pinned gets. */
let cached: LLMProvider | null = null;

/** Providers for workspaces pinned to a named vendor. */
const byVendor = new Map<LlmVendorKey, LLMProvider>();

/**
 * A test double that stands in for **every** vendor.
 *
 * Set by `setLlmProvider`. It has to win over per-vendor resolution or a suite that injects a mock
 * would still make live billable calls for any workspace that happens to be pinned — which is the
 * kind of thing you discover on an invoice.
 */
let override: LLMProvider | null = null;

export const llmProvider = (): LLMProvider => {
  if (override) return override;
  if (cached) return cached;

  const kind = env.engine.llmProvider;
  if (kind === 'openai' && env.llm.apiKey) {
    cached = new OpenAIProvider();
  } else {
    if (kind === 'openai') {
      /*
       * Named a vendor and gave it no key.
       *
       * Worth its own message, because the fix is different: with `LLM_VENDOR=groq` set, the
       * resolver reads only `GROQ_LLM_*` and deliberately will NOT borrow `OPENAI_API_KEY` —
       * so the usual "add a key" advice points at the wrong variable.
       */
      logger.warn(
        env.llm.vendor
          ? `LLM_VENDOR=${env.llm.vendor} but ${env.llm.vendor}_LLM_API_KEY is not set — using the `
            + 'mock router. Another vendor\'s key is deliberately NOT used as a fallback.'
          : 'LLM_PROVIDER=openai but no LLM_API_KEY/OPENAI_API_KEY is set — using the mock router',
      );
    }
    cached = new MockLLMProvider();
  }

  // The vendor, model and structured mode are all logged, because "which model answered" is the
  // first question anyone asks about a latency, quality or billing change, and `provider` alone
  // cannot say — it reads 'openai' for any OpenAI-compatible endpoint, Groq included.
  logger.info('LLM provider selected', {
    provider: cached.name,
    vendor: env.llm.vendor || '(unprefixed LLM_*/OPENAI_*)',
    model: cached.name === 'mock' ? null : env.llm.model,
    baseUrl: cached.name === 'mock' ? null : (env.llm.baseUrl || 'https://api.openai.com/v1'),
    structuredMode: cached.name === 'mock' ? null : env.llm.structuredMode,
    // Which other vendors this box *could* serve, so the console's options and the server's
    // capabilities can be compared without reading the environment by hand.
    alsoConfigured: LLM_VENDOR_KEYS.filter((v) => env.llm.byVendor[v] !== null).join(', ') || 'none',
  });
  return cached;
};

/**
 * The provider for a workspace, given the vendor an operator pinned it to.
 *
 * `null` — the ordinary case — is the platform default.
 *
 * ── What happens when the pinned vendor has no key here ─────────────────────
 *
 * It falls back to the platform default and logs a warning. Three options were available and this is
 * the least bad:
 *
 *   • **The mock** would send "This is a mock assistant reply." to a paying customer. Never.
 *   • **Refusing** would leave the customer with the workspace's fallback text for a configuration
 *     mistake nobody in that workspace made or can fix.
 *   • **The platform default** answers the customer properly, and gets the vendor wrong in a way the
 *     log names explicitly.
 *
 * The console refuses to pin a workspace to an unconfigured vendor in the first place, so reaching
 * this branch means the key was removed after the choice was made — or the choice was made on another
 * box. Either way it is worth a line in the log rather than silence.
 */
export const providerForVendor = (vendor: LlmVendorKey | null | undefined): LLMProvider => {
  if (override) return override;
  if (!vendor) return llmProvider();

  const existing = byVendor.get(vendor);
  if (existing) return existing;

  const settings = env.llm.byVendor[vendor];
  if (!settings) {
    logger.warn('A workspace is pinned to a vendor with no key on this box — using the platform default', {
      pinnedVendor: vendor,
      missingVariable: `${vendor}_LLM_API_KEY`,
      platformVendor: env.llm.vendor || '(unprefixed LLM_*/OPENAI_*)',
    });
    return llmProvider();
  }

  const provider = new OpenAIProvider(settings);
  byVendor.set(vendor, provider);
  logger.info('LLM provider built for a pinned vendor', {
    vendor, provider: provider.name, model: settings.model, structuredMode: settings.structuredMode,
  });
  return provider;
};

/**
 * The provider that writes workflows, which is **always OpenAI** whatever a workspace is pinned to.
 *
 * ── Why authoring does not follow the workspace's vendor ─────────────────────
 *
 * A per-workspace vendor is about answering customers: short replies, on the hot path, where latency
 * is the cost being managed. Generating a workflow is a different job with different requirements —
 * a large node graph that has to satisfy a strict JSON Schema first time, from a long instruction.
 *
 * That is exactly where `json_schema` strict constrained decoding earns its keep, and it is the one
 * genuinely non-portable thing in this file: Groq is configured `json_object`, where the model is
 * merely *asked* for the shape. A router can absorb that — a malformed reply is treated as no-match
 * and the customer gets the fallback. A generator cannot: the failure is a draft that fails
 * validation, and the person who clicked the button waits for it twice.
 *
 * So generation is pinned, and the pin lives here rather than as a bare `'OPENAI'` at the call site,
 * because this is where the reason for it belongs.
 */
export const authoringProvider = (): LLMProvider => providerForVendor('OPENAI');

/**
 * Replace every provider with one instance, or clear the replacement.
 *
 * For tests and the bench script. It overrides the pinned-vendor path too — see `override`.
 */
export const setLlmProvider = (provider: LLMProvider | null): void => {
  override = provider;
  if (provider === null) {
    // Also drop what was built from a previous environment, so a suite that changes `LLM_*` and
    // clears the override does not keep answering from a client built against the old settings.
    cached = null;
    byVendor.clear();
  }
};
