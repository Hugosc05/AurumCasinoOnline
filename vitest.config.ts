import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/engine/test/**/*.test.ts',
      'apps/server/test/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'apps/web/src/**/*.test.tsx',
    ],
    environment: 'node',
    testTimeout: 20000,
    pool: 'forks',
  },
});
