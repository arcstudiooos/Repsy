import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'worker',
    globalSetup: ['../../packages/db/vitest.global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
