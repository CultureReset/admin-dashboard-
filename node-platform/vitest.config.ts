import { defineConfig } from 'vitest/config';

// Explicit config so vitest does not walk up and pick up the dashboard app's
// vite.config.js from the parent repo.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each file opens its own in-memory Postgres; run them one at a time so
    // memory stays sane.
    pool: 'forks',
    maxForks: 1,
  },
});
