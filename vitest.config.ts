import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts', 'apps/server/test/**/*.test.ts'],
    testTimeout: 30_000,
    pool: 'forks',
  },
});
