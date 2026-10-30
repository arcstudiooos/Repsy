import { defineConfig, devices } from '@playwright/test';

/**
 * The offline spec (S3-3) against `next build` + `next start` on port 3300 (e2e/support/stack.ts with
 * E2E_WEB_MODE=prod): the portal service worker needs stable build assets to serve the workout offline, which the
 * dev server's on-demand chunks and HMR don't give. Every other spec stays on the dev server (playwright.config.ts).
 */
const port = Number(process.env.E2E_WEB_PORT ?? 3300);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: ['**/offline.spec.ts'],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 120_000,
  use: { baseURL, trace: 'on-first-retry' },
  webServer: {
    command: 'pnpm exec tsx e2e/support/stack.ts',
    env: { E2E_WEB_MODE: 'prod', E2E_WEB_PORT: String(port) },
    url: `${baseURL}/healthz`,
    reuseExistingServer: false,
    // Includes `next build`.
    timeout: 600_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
