import { defineConfig, devices } from '@playwright/test';

// Must match e2e/support/stack.ts (3100 is left to `pnpm dev`).
const port = Number(process.env.E2E_WEB_PORT ?? 3200);
// STAGING_URL points the smoke spec at a hosted environment; no local stack is started then.
const stagingUrl = process.env.STAGING_URL;
const baseURL = stagingUrl ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  // Runs against a production build instead: playwright.offline.config.ts.
  testIgnore: ['**/offline.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: { baseURL, trace: 'on-first-retry' },
  // Prepares the DB, then starts web + worker (see e2e/support/stack.ts).
  webServer: stagingUrl
    ? undefined
    : {
        command: 'pnpm exec tsx e2e/support/stack.ts',
        url: `${baseURL}/healthz`,
        reuseExistingServer: false,
        timeout: 240_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
