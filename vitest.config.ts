import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    // Runs before any test module is imported, so `src/lib/env.ts` is configured
    // before it caches process.env. See tests/setup.ts for why this matters.
    setupFiles: ['./tests/setup.ts'],
    // Each integration test file gets its own embedded PostgreSQL database, so
    // they run one at a time to avoid sharing a single PGlite data directory.
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Vitest 4 removed the nested `poolOptions` block. `fileParallelism: false`
    // already serialises test files, which is what keeps each file's embedded
    // PostgreSQL database from colliding with another's.
    pool: 'forks',
  },
});
