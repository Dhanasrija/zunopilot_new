import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// How the provider talks to whoever is serving the model.
//
// The point of these tests is the **shape of the request**, not the reply. Everything here is
// about being able to move to Groq or Gemini Flash without a code change, and the two things that
// can silently go wrong are: the base URL is ignored so we keep paying OpenAI latency while
// believing otherwise, and `json_object` mode drops the schema so the model is left guessing the
// shape. Neither shows up as an error — the first looks like "the fast model isn't faster" and the
// second like "the router got worse". So both are asserted directly.
//
// No network. A stub for the OpenAI SDK captures the constructor options and the request body.

const created = vi.fn();
const constructed = vi.fn();

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: created } };

    constructor(options: unknown) { constructed(options); }
  },
}));

/** Load `llm.ts` fresh against a given env, since the provider reads config at construction. */
const providerWith = async (envOverrides: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const { OpenAIProvider } = await import('./llm.js');
  return new OpenAIProvider('test-key');
};

const A_REPLY = (content: string) => ({
  choices: [{ message: { content } }],
  model: 'whatever-model',
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});

const SCHEMA = {
  type: 'object',
  properties: { decision: { type: 'string' } },
  required: ['decision'],
  additionalProperties: false,
};

const structuredRequest = {
  systemPrompt: 'You route messages.',
  userPrompt: 'do you deliver on sundays',
  schemaName: 'workflow_routing_decision',
  jsonSchema: SCHEMA,
};

const saved = { ...process.env };

beforeEach(() => {
  created.mockReset();
  constructed.mockReset();
  created.mockResolvedValue(A_REPLY('{"decision":"NO_MATCH"}'));
});

afterEach(() => {
  process.env = { ...saved };
  vi.resetModules();
});

describe('pointing at a different vendor', () => {
  it('**passes the configured base URL to the client**', async () => {
    // Without this the SDK talks to OpenAI regardless of what the config says — and the symptom
    // is that the "faster" model is not faster, which is a miserable thing to debug.
    await providerWith({ LLM_BASE_URL: 'https://api.groq.com/openai/v1', LLM_MODEL: 'llama-3.3-70b-versatile' });
    expect(constructed).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://api.groq.com/openai/v1' }),
    );
  });

  it('omits baseURL entirely when unset, so OpenAI stays the default', async () => {
    await providerWith({ LLM_BASE_URL: undefined, OPENAI_BASE_URL: undefined });
    expect(constructed.mock.calls[0][0]).not.toHaveProperty('baseURL');
  });

  it('**names itself after the host, so the logs and RoutingDecision do not lie**', async () => {
    const groq = await providerWith({ LLM_BASE_URL: 'https://api.groq.com/openai/v1' });
    expect(groq.name).toBe('groq.com');

    const openai = await providerWith({ LLM_BASE_URL: undefined, OPENAI_BASE_URL: undefined });
    expect(openai.name).toBe('openai');
  });

  it('honours the OPENAI_* aliases, so a deployed .env keeps working', async () => {
    const provider = await providerWith({
      LLM_BASE_URL: undefined,
      LLM_MODEL: undefined,
      OPENAI_BASE_URL: 'https://legacy.example.com/v1',
      OPENAI_MODEL: 'gpt-4o-mini',
    });
    expect(provider.name).toBe('legacy.example.com');
    expect(constructed).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: 'https://legacy.example.com/v1' }),
    );
  });
});

describe('asking for structured output', () => {
  it('uses strict json_schema by default', async () => {
    const provider = await providerWith({ LLM_STRUCTURED_MODE: undefined });
    await provider.completeStructured(structuredRequest);

    const body = created.mock.calls[0][0];
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'workflow_routing_decision', strict: true, schema: SCHEMA },
    });
    // Strict mode constrains the output, so the schema does not need repeating in the prompt.
    expect(body.messages[0].content).toBe('You route messages.');
  });

  it('**in json_object mode, sends json_object AND puts the schema in the prompt**', async () => {
    // Both halves matter. A test that only checked `response_format` would pass while the model
    // was told to return JSON without ever being told which JSON — the exact failure that would
    // look like "the cheaper model routes badly".
    const provider = await providerWith({ LLM_STRUCTURED_MODE: 'json_object' });
    await provider.completeStructured(structuredRequest);

    const body = created.mock.calls[0][0];
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content).toContain('You route messages.');
    expect(body.messages[0].content).toContain('"decision"');
  });

  it('keeps the schema out of the user prompt, which carries the customer’s own words', async () => {
    // A schema sitting next to whatever the customer typed is one more thing they could try to
    // talk over. Operator-authored instructions belong in the system message.
    const provider = await providerWith({ LLM_STRUCTURED_MODE: 'json_object' });
    await provider.completeStructured(structuredRequest);

    const body = created.mock.calls[0][0];
    expect(body.messages[1].content).toBe('do you deliver on sundays');
    expect(body.messages[1].content).not.toContain('additionalProperties');
  });
});

describe('reading the reply', () => {
  it('**tolerates a code fence in json_object mode**', async () => {
    // The most common way a smaller model disobeys "JSON only". The content is right and the
    // packaging is not, so refusing it would throw away a perfectly good routing decision.
    created.mockResolvedValue(A_REPLY('```json\n{"decision":"START_WORKFLOW"}\n```'));
    const provider = await providerWith({ LLM_STRUCTURED_MODE: 'json_object' });

    const response = await provider.completeStructured(structuredRequest);
    expect(response.data).toEqual({ decision: 'START_WORKFLOW' });
  });

  it('does **not** tolerate a fence under strict mode, where one is impossible', async () => {
    // Under constrained decoding the reply is guaranteed bare JSON, so a fence means something is
    // genuinely wrong and quietly accepting it would hide it.
    created.mockResolvedValue(A_REPLY('```json\n{"decision":"START_WORKFLOW"}\n```'));
    const provider = await providerWith({ LLM_STRUCTURED_MODE: 'json_schema' });

    await expect(provider.completeStructured(structuredRequest)).rejects.toThrow();
  });

  it('refuses prose that merely contains JSON, rather than guessing', async () => {
    // Fishing for the first `{` would accept a model that ignored the instruction entirely. The
    // router treats a parse failure as no-match, which is the better answer than a routed guess.
    created.mockResolvedValue(A_REPLY('Sure! Here you go: {"decision":"NO_MATCH"} hope that helps'));
    const provider = await providerWith({ LLM_STRUCTURED_MODE: 'json_object' });

    await expect(provider.completeStructured(structuredRequest)).rejects.toThrow();
  });

  it('throws on an empty reply', async () => {
    created.mockResolvedValue({ ...A_REPLY(''), choices: [{ message: { content: '' } }] });
    const provider = await providerWith({});
    await expect(provider.completeStructured(structuredRequest)).rejects.toThrow(/no content/i);
  });

  it('reports a latency, which is what the model comparison is built on', async () => {
    const provider = await providerWith({});
    const response = await provider.completeStructured(structuredRequest);
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
    expect(response.tokenUsage).toEqual({ prompt: 10, completion: 5, total: 15 });
  });
});

describe('the free-form call', () => {
  it('sends no response_format at all, so it works on any vendor', async () => {
    created.mockResolvedValue(A_REPLY('a friendly answer'));
    const provider = await providerWith({ LLM_STRUCTURED_MODE: 'json_object' });

    const result = await provider.complete({ systemPrompt: 'be nice', userPrompt: 'hi' });

    expect(created.mock.calls[0][0]).not.toHaveProperty('response_format');
    expect(result.text).toBe('a friendly answer');
  });
});
