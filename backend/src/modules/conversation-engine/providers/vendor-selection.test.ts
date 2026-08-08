import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * Which vendor answers which workspace.
 *
 * ── Why this is a fresh-module test rather than an integration one ───────────
 *
 * The thing being tested is what a process resolves from its environment, and `env.ts` snapshots
 * `process.env` at import. So each case re-imports the module graph against a set of variables, the
 * same way `llm-provider.test.ts` already does — and for the same reason: a test that mutated the
 * live `env` object would be testing a shape nothing in production ever has.
 *
 * Four properties, and the second is the one that would cost real money if it broke:
 *
 *   1. Both vendors resolve independently, each from its own prefix.
 *   2. **Two workspaces in one process get two different providers.** This is the whole feature. A
 *      cache keyed on nothing — the single `cached` instance this replaced — would hand the second
 *      workspace whichever vendor the first one happened to warm up.
 *   3. A workspace pinned to a vendor with no key here falls back to the platform default, loudly,
 *      rather than to the mock. A canned reply to a paying customer is worse than the wrong invoice.
 *   4. Workflow generation ignores the pin entirely and uses OpenAI.
 */

/*
 * ── Two things about this environment that shape every case below ────────────
 *
 * **A variable is blanked, never deleted.** `env.ts` loads `.env` on import, and dotenv fills in any
 * key that is *absent* from `process.env` — so `delete` hands the real Groq key straight back. An
 * empty string is present, and every reader here treats blank as unset.
 *
 * **`LLM_PROVIDER` is `mock` in the test environment**, deliberately, so no suite can reach a vendor
 * by accident. The cases that assert on the *platform default* have to set it to `openai` to get past
 * that — which is safe, because constructing an SDK client makes no request.
 */
const BASE_ENV = {
  LLM_PROVIDER: undefined,
  LLM_VENDOR: undefined,
  LLM_API_KEY: undefined,
  LLM_MODEL: undefined,
  LLM_BASE_URL: undefined,
  OPENAI_API_KEY: undefined,
  OPENAI_MODEL: undefined,
  GROQ_LLM_API_KEY: undefined,
  GROQ_LLM_MODEL: undefined,
  GROQ_LLM_BASE_URL: undefined,
  GROQ_LLM_STRUCTURED_MODE: undefined,
} as Record<string, string | undefined>;

const saved: Record<string, string | undefined> = {};

/** Load the provider module fresh against a given environment. */
const load = async (overrides: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...overrides })) {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return {
    llm: await import('./llm.js'),
    env: (await import('../../../config/env.js')).env,
  };
};

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const BOTH = {
  OPENAI_API_KEY: 'sk-openai-test',
  OPENAI_MODEL: 'gpt-4o-mini',
  GROQ_LLM_API_KEY: 'gsk-groq-test',
  GROQ_LLM_MODEL: 'llama-3.3-70b-versatile',
  GROQ_LLM_BASE_URL: 'https://api.groq.com/openai/v1',
};

describe('resolving a vendor from the environment', () => {
  it('**reads each vendor from its own prefix**', async () => {
    const { env } = await load(BOTH);

    expect(env.llm.byVendor.OPENAI?.model).toBe('gpt-4o-mini');
    expect(env.llm.byVendor.OPENAI?.baseUrl).toBe('');
    expect(env.llm.byVendor.GROQ?.model).toBe('llama-3.3-70b-versatile');
    expect(env.llm.byVendor.GROQ?.baseUrl).toBe('https://api.groq.com/openai/v1');
  });

  it('**reports a vendor with no key as unavailable rather than guessing**', async () => {
    // The console reads this to disable the option. Borrowing the other vendor's key here is the
    // exact failure `llmSetting` was hardened against: working, billable, and the wrong vendor.
    const { env } = await load({ OPENAI_API_KEY: 'sk-openai-test', GROQ_LLM_API_KEY: '' });

    expect(env.llm.byVendor.OPENAI).not.toBeNull();
    expect(env.llm.byVendor.GROQ).toBeNull();
  });

  it('defaults Groq to json_object and OpenAI to json_schema', async () => {
    /*
     * Not a preference: `json_schema` is OpenAI's strict constrained decoding and support elsewhere
     * is model-dependent. Inheriting OpenAI's mode on Groq does not error — it silently degrades the
     * router, which is the sort of thing nobody notices for a month.
     */
    const { env } = await load(BOTH);

    expect(env.llm.byVendor.OPENAI?.structuredMode).toBe('json_schema');
    expect(env.llm.byVendor.GROQ?.structuredMode).toBe('json_object');
  });
});

describe('which provider a workspace gets', () => {
  it('**gives two workspaces on two vendors two different providers**', async () => {
    const { llm } = await load(BOTH);

    const openai = llm.providerForVendor('OPENAI');
    const groq = llm.providerForVendor('GROQ');

    // Different instances, and each naming its own endpoint — `providerNameFor` reads the host, so
    // this is the observable difference between them.
    expect(openai).not.toBe(groq);
    expect(openai.name).toBe('openai');
    expect(groq.name).toBe('groq.com');
  });

  it('reuses one provider per vendor rather than building one per message', async () => {
    // The client holds a connection pool worth keeping across the thousands of messages a busy
    // workspace sends. Per-message construction would throw that away on the hottest path.
    const { llm } = await load(BOTH);

    expect(llm.providerForVendor('GROQ')).toBe(llm.providerForVendor('GROQ'));
  });

  it('**falls back to the platform default when the pinned vendor has no key here**', async () => {
    const { llm } = await load({
      OPENAI_API_KEY: 'sk-openai-test', GROQ_LLM_API_KEY: '', LLM_PROVIDER: 'openai',
    });

    const pinned = llm.providerForVendor('GROQ');

    // The platform default, not the mock: a real answer on the wrong vendor beats "This is a mock
    // assistant reply." reaching a customer.
    expect(pinned.name).toBe('openai');
    expect(pinned).toBe(llm.llmProvider());
  });

  it('gives an unpinned workspace the platform default', async () => {
    const { llm } = await load({ ...BOTH, LLM_VENDOR: 'groq', LLM_PROVIDER: 'openai' });

    // `LLM_VENDOR=groq` makes Groq the platform default, so null resolves there — which is what
    // makes leaving a workspace unpinned meaningful: the platform's choice can change under it.
    expect(llm.providerForVendor(null).name).toBe('groq.com');
    expect(llm.providerForVendor(undefined)).toBe(llm.providerForVendor(null));
  });
});

describe('writing workflows', () => {
  it('**always uses OpenAI, whatever the workspace is pinned to**', async () => {
    /*
     * Generating a node graph against a strict schema is a different job from a two-line reply, and
     * it is the one place where losing `json_schema` costs a visible retry rather than a duller
     * answer. Decided deliberately, so it gets a test rather than a comment.
     */
    const { llm } = await load({ ...BOTH, LLM_VENDOR: 'groq', LLM_PROVIDER: 'openai' });

    expect(llm.authoringProvider().name).toBe('openai');
    // Even though everything else on this box is on Groq.
    expect(llm.providerForVendor(null).name).toBe('groq.com');
  });
});

describe('a test double', () => {
  it('**stands in for every vendor, including a pinned one**', async () => {
    /*
     * The property that stops a suite making live billable calls. Before per-vendor resolution there
     * was one instance and `setLlmProvider` replaced it; now a workspace pinned to Groq would route
     * around the override unless it is checked first.
     */
    const { llm } = await load(BOTH);
    const double = { name: 'double' } as unknown as Parameters<typeof llm.setLlmProvider>[0];

    llm.setLlmProvider(double);
    expect(llm.providerForVendor('GROQ')).toBe(double);
    expect(llm.providerForVendor(null)).toBe(double);
    expect(llm.authoringProvider()).toBe(double);

    llm.setLlmProvider(null);
    expect(llm.providerForVendor('GROQ').name).toBe('groq.com');
  });
});
