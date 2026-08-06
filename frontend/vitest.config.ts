import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The frontend test config, kept separate from `vite.config.ts` on purpose.
//
// Merging them would drag the dev server's proxy and `allowedHosts` into every test run, and
// would mean a change made for the tunnel could break the suite. The only thing the two must
// agree on is the `@` alias — if that drifts, every import in a test resolves to nothing.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Only real test files. Without this, `scripts/*.mjs` and anything under `dist/` get
    // collected as suites.
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
