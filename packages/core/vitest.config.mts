import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'core',
    globalSetup: ['../db/vitest.global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
