import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'db',
    globalSetup: ['./vitest.global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
