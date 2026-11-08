/**
 * Screenshots of the main routes at 375 and 1440, light and dark (S5-5, §12, D-018). Runs only with SCREENSHOTS_DIR set:
 * `SCREENSHOTS_DIR=../../docs/screenshots pnpm --filter @repsy/web exec playwright test screenshots`.
 */
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { assignFromClientTab, buildProgram, onboardClient } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const DIR = process.env.SCREENSHOTS_DIR;

/** Light and dark (D-018), at 375 and 1440. The theme is the saved per-device choice the app itself uses. */
async function shoot(page: Page, name: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((t) => {
      window.localStorage.setItem('repsy-theme', t);
      document.documentElement.dataset.theme = t;
    }, theme);
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.screenshot({
        path: join(DIR as string, `${name}${theme === 'dark' ? '-dark' : ''}-${width}.jpg`),
        type: 'jpeg',
        quality: 60,
        fullPage: true,
      });
    }
  }
  await page.evaluate(() => {
    window.localStorage.setItem('repsy-theme', 'light');
    document.documentElement.dataset.theme = 'light';
  });
}

test.describe('screenshots', () => {
  test.skip(!DIR, 'set SCREENSHOTS_DIR to capture');
  test.describe.configure({ timeout: 300_000 });

  test('main routes', async ({ page, request, browser }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Sam Sample');
    try {
      await buildProgram(page, 'Strength block', [
        [
          ['bench', 'Barbell Bench Press'],
          ['plank', 'Plank'],
        ],
      ]);
      await assignFromClientTab(page, 'Sam Sample', 'Strength block');
      const coachRoutes: [string, string][] = [
        ['coach-dashboard', '/app'],
        ['coach-clients', '/app/clients'],
        ['coach-programs', '/app/programs'],
        ['coach-review', '/app/review'],
        ['coach-messages', '/app/messages'],
        ['coach-analytics', '/app/analytics'],
        ['coach-checkin-questions', '/app/check-ins'],
        ['coach-settings', '/settings'],
      ];
      for (const [name, path] of coachRoutes) {
        await page.goto(path);
        await expect(page.getByRole('main')).toBeVisible({ timeout: 30_000 });
        await shoot(page, name);
      }
      await page.goto('/app/clients');
      await page.getByRole('link', { name: 'Sam Sample' }).first().click();
      await expect(page.getByRole('heading', { name: 'Sam Sample', level: 1 })).toBeVisible();
      await shoot(page, 'coach-client-overview');

      const portal = client.page;
      for (const [name, path] of [
        ['portal-home', '/portal'],
        ['portal-workouts', '/portal/workouts'],
        ['portal-checkins', '/portal/check-ins'],
        ['portal-messages', '/portal/messages'],
        ['portal-profile', '/portal/profile'],
      ] as const) {
        await portal.goto(path);
        await expect(portal.getByRole('main')).toBeVisible({ timeout: 30_000 });
        await shoot(portal, name);
      }
      await portal.goto('/portal');
      await portal.getByRole('link', { name: /Start workout/ }).click();
      await portal.getByRole('button', { name: 'Start workout' }).click();
      await expect(portal.getByRole('region', { name: 'Barbell Bench Press' })).toBeVisible({
        timeout: 30_000,
      });
      await shoot(portal, 'portal-workout-logging');
    } finally {
      await client.context.close();
    }
  });
});
