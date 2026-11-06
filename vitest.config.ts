import { defineConfig } from 'vitest/config';

// Shared laptop: cap parallelism at 2 workers.
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    maxWorkers: 2,
  },
});
