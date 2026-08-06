import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Choosing an LLM vendor from the environment.
 *
 * `env.ts` snapshots `process.env` at import, so each case here re-imports the module with
 * `vi.resetModules()` after setting the variables. That is the only way to exercise a snapshot,
 * and it is also a reminder of why the snapshot matters operationally: nothing re-reads these
 * until the process restarts.
 *
 * The property worth the most: **a named vendor never resolves to a different vendor's key.**
 * Before `LLM_VENDOR` existed, putting a Groq key in `GROQ_LLM_API_KEY` left `LLM_API_KEY`
 * empty, resolution fell through to `OPENAI_API_KEY`, and the router ran on OpenAI — working,
 * billable, and not what the operator configured. Nothing in a log said so.
 */

const BASE = {
  DATABASE_URL: 'postgresql://u@localhost:5432/d',
  JWT_SECRET: '0123456789012345678901234567890123456789',
};

/*
 * Isolating this suite from the developer's own `.env`, which took two attempts.
 *
 * `env.ts` line 2 is `dotenv.config()`, and it runs again on every re-import. dotenv skips any
 * key already present in `process.env` but fills in any that is absent — so both obvious
 * approaches fail:
 *
 *   - `delete process.env.GROQ_LLM_MODEL` hands the slot back to dotenv, which refills it from
 *     the real file. Three cases failed against the machine's actual Groq settings.
 *   - Blanking only the keys that are *currently* present does nothing when the snapshot was
 *     taken before dotenv ever ran, which is exactly when this file captures it. Same failure.
 *
 * So every name the resolver could read is written to '' explicitly, present or not. That holds
 * the slot against dotenv, and the resolver treats empty as absent — which is the behaviour
 * under test anyway.
 */
const PREFIXES = ['LLM', 'OPENAI', 'OPENAI_LLM', 'GROQ', 'GROQ_LLM', 'GEMINI', 'GEMINI_LLM', 'TYPO', 'TYPO_LLM'];
const SUFFIXES = ['API_KEY', 'MODEL', 'BASE_URL', 'STRUCTURED_MODE', 'EXTRA_BODY', 'TIMEOUT_MS'];
const CONTROLLED = [
  'LLM_VENDOR',
  'LLM_PROVIDER',
  ...PREFIXES.flatMap((p) => SUFFIXES.map((s) => `${p}_${s}`)),
];

/** Load `env.ts` fresh with exactly these variables and nothing else leaking in. */
const loadEnv = async (vars: Record<string, string>) => {
  for (const key of CONTROLLED) process.env[key] = '';
  Object.assign(process.env, BASE, vars);
  vi.resetModules();
  return (await import('./env.js')).env;
};

const ORIGINAL = { ...process.env };

beforeEach(() => { process.env = { ...ORIGINAL }; });
afterEach(() => { process.env = { ...ORIGINAL }; vi.resetModules(); });

describe('no vendor named', () => {
  it('reads the unprefixed names, exactly as before this existed', async () => {
    const env = await loadEnv({ LLM_API_KEY: 'sk-a', LLM_MODEL: 'gpt-4o-mini' });
    expect(env.llm.apiKey).toBe('sk-a');
    expect(env.llm.model).toBe('gpt-4o-mini');
    expect(env.llm.vendor).toBe('');
  });

  it('still honours OPENAI_* as the second tier', async () => {
    // Deployments that predate LLM_* must keep working untouched.
    const env = await loadEnv({ OPENAI_API_KEY: 'sk-legacy', OPENAI_MODEL: 'gpt-4o' });
    expect(env.llm.apiKey).toBe('sk-legacy');
    expect(env.llm.model).toBe('gpt-4o');
  });

  it('prefers LLM_* over OPENAI_* when both are present', async () => {
    const env = await loadEnv({ LLM_API_KEY: 'sk-new', OPENAI_API_KEY: 'sk-old' });
    expect(env.llm.apiKey).toBe('sk-new');
  });
});

describe('a vendor named', () => {
  const GROQ = {
    GROQ_LLM_API_KEY: 'gsk-groq',
    GROQ_LLM_BASE_URL: 'https://api.groq.com/openai/v1',
    GROQ_LLM_MODEL: 'llama-3.3-70b-versatile',
    GROQ_LLM_STRUCTURED_MODE: 'json_object',
  };

  it('**reads that vendor’s prefixed block**', async () => {
    const env = await loadEnv({ LLM_VENDOR: 'groq', ...GROQ });
    expect(env.llm.apiKey).toBe('gsk-groq');
    expect(env.llm.model).toBe('llama-3.3-70b-versatile');
    expect(env.llm.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(env.llm.structuredMode).toBe('json_object');
  });

  it('is case-insensitive, because nobody remembers which way it was written', async () => {
    for (const spelling of ['groq', 'GROQ', 'Groq', ' groq ']) {
      // eslint-disable-next-line no-await-in-loop
      const env = await loadEnv({ LLM_VENDOR: spelling, ...GROQ });
      expect(env.llm.apiKey, `LLM_VENDOR=${JSON.stringify(spelling)}`).toBe('gsk-groq');
    }
  });

  it('switches everything with one line, leaving both blocks in place', async () => {
    const both = { ...GROQ, OPENAI_API_KEY: 'sk-openai', OPENAI_MODEL: 'gpt-4o-mini' };

    const groq = await loadEnv({ LLM_VENDOR: 'groq', ...both });
    expect(groq.llm.apiKey).toBe('gsk-groq');
    expect(groq.llm.model).toBe('llama-3.3-70b-versatile');

    const openai = await loadEnv({ LLM_VENDOR: 'openai', ...both });
    expect(openai.llm.apiKey).toBe('sk-openai');
    expect(openai.llm.model).toBe('gpt-4o-mini');
    // OpenAI's own structured mode, not the one Groq needed.
    expect(openai.llm.structuredMode).toBe('json_schema');
  });

  it('accepts the unsuffixed convention too, so OPENAI_API_KEY needs no rename', async () => {
    // `OPENAI_LLM_API_KEY` would be the consistent name, but `OPENAI_API_KEY` is what is
    // already in every deployed .env. Both resolve.
    const env = await loadEnv({ LLM_VENDOR: 'openai', OPENAI_API_KEY: 'sk-openai' });
    expect(env.llm.apiKey).toBe('sk-openai');
  });

  it('lets a brand-new vendor work with no code change', async () => {
    // The reason this exists: adding a vendor should be a prefixed block and one line.
    const env = await loadEnv({
      LLM_VENDOR: 'gemini',
      GEMINI_LLM_API_KEY: 'goog-key',
      GEMINI_LLM_MODEL: 'gemini-2.5-flash',
      GEMINI_LLM_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      GEMINI_LLM_STRUCTURED_MODE: 'json_object',
    });
    expect(env.llm.apiKey).toBe('goog-key');
    expect(env.llm.model).toBe('gemini-2.5-flash');
    expect(env.llm.baseUrl).toContain('googleapis.com');
  });

  it('takes vendor-specific extra body, so the thinking-budget knob travels with its vendor', async () => {
    const env = await loadEnv({
      LLM_VENDOR: 'gemini',
      GEMINI_LLM_API_KEY: 'goog-key',
      GEMINI_LLM_EXTRA_BODY: '{"extra_body":{"google":{"thinking_config":{"thinking_budget":0}}}}',
      LLM_EXTRA_BODY: '{"should":"not be used"}',
    });
    expect(env.llm.extraBody).toMatchObject({ extra_body: { google: { thinking_config: { thinking_budget: 0 } } } });
    expect(env.llm.extraBody).not.toHaveProperty('should');
  });
});

describe('a named vendor never borrows another vendor’s credentials', () => {
  it('**resolves to no key at all when the named vendor has none**', async () => {
    /*
     * The bug this whole mechanism is defending against. `LLM_VENDOR=groq` with the Groq key
     * missing must NOT fall through to `OPENAI_API_KEY`. Falling through turns a typo into a
     * silent vendor switch: the router keeps working, the bill goes to the wrong vendor, and
     * the operator has no way to tell.
     */
    const env = await loadEnv({
      LLM_VENDOR: 'groq',
      GROQ_LLM_MODEL: 'llama-3.3-70b-versatile',
      OPENAI_API_KEY: 'sk-openai-must-not-be-used',
      LLM_API_KEY: 'sk-generic-must-not-be-used',
    });

    expect(env.llm.apiKey).toBe('');
    // And the router is off rather than quietly answering as somebody else.
    expect(env.engine.llmProvider).toBe('mock');
  });

  it('does not borrow another vendor’s base URL either', async () => {
    // A Groq key against OpenAI's endpoint would 401; an OpenAI key against Groq's would too.
    // Mixing halves of two vendors is never a configuration anybody wants.
    const env = await loadEnv({
      LLM_VENDOR: 'groq',
      GROQ_LLM_API_KEY: 'gsk-groq',
      LLM_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_BASE_URL: 'https://api.openai.com/v1',
    });
    expect(env.llm.baseUrl).toBe('');
  });

  it('treats an empty value as absent, not as a deliberate blank', async () => {
    // `GROQ_LLM_API_KEY=` in a file reads as set-but-empty. It must not count as configured —
    // the "unset reads as configured" mistake, which this codebase has made five times.
    const env = await loadEnv({
      LLM_VENDOR: 'groq',
      GROQ_LLM_API_KEY: '   ',
      OPENAI_API_KEY: 'sk-openai',
    });
    expect(env.llm.apiKey).toBe('');
    expect(env.engine.llmProvider).toBe('mock');
  });

  it('names an unknown vendor into silence rather than into someone else’s account', async () => {
    const env = await loadEnv({ LLM_VENDOR: 'typo', OPENAI_API_KEY: 'sk-openai' });
    expect(env.llm.apiKey).toBe('');
    expect(env.engine.llmProvider).toBe('mock');
  });
});

describe('what the router reports about itself', () => {
  it('exposes the vendor so the boot log can say which block is live', async () => {
    const env = await loadEnv({ LLM_VENDOR: 'groq', GROQ_LLM_API_KEY: 'gsk' });
    expect(env.llm.vendor).toBe('GROQ');
  });

  it('falls back to a working default model rather than an empty string', async () => {
    // An empty model would reach the vendor as a malformed request; a wrong-but-valid default
    // fails with a clear "model not found" instead.
    const env = await loadEnv({ LLM_VENDOR: 'groq', GROQ_LLM_API_KEY: 'gsk' });
    expect(env.llm.model).toBe('gpt-4o-mini');
  });

  it('keeps the 8s timeout when the vendor block does not set one', async () => {
    // A customer is waiting on WhatsApp; an unset timeout must not become no timeout.
    const env = await loadEnv({ LLM_VENDOR: 'groq', GROQ_LLM_API_KEY: 'gsk' });
    expect(env.llm.timeoutMs).toBe(8000);
  });

  it('honours a vendor-specific timeout', async () => {
    const env = await loadEnv({
      LLM_VENDOR: 'groq', GROQ_LLM_API_KEY: 'gsk', GROQ_LLM_TIMEOUT_MS: '3000',
    });
    expect(env.llm.timeoutMs).toBe(3000);
  });
});
