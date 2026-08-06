import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Suites that touch Postgres share one database, so they must not interleave.
    // Pure-unit suites are fast enough that serialising them costs nothing.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      // Belt and braces: env.ts already forces the mock adapters under
      // NODE_ENV=test, so a test run can never reach Meta or OpenAI.
      WHATSAPP_PROVIDER: 'mock',
      LLM_PROVIDER: 'mock',
      // The project's own .env sets LOG_LEVEL=debug, which buries the test
      // report under engine logs. Override it here rather than in .env, so
      // debugging a single test is still `LOG_LEVEL=debug npx vitest run <file>`.
      LOG_LEVEL: 'info',
    },
    testTimeout: 15_000,
  },
});
