import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

/**
 * PRD A7: every coach screen works one-handed at 375 px. Each page is opened at phone width, checked for sideways
 * scrolling and accessibility, and the bottom navigation stays in reach.
 */
test.describe('coach on mobile (PRD A7)', () => {
  test.describe.configure({ timeout: 360_000 });

  test('the main coach screens fit 375 px with the navigation in reach', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Mia Mobile');
    try {
      await buildProgram(page, 'Mobile block', [[['bench', 'Barbell Bench Press']]]);
      const programPath = new URL(page.url()).pathname;
      await assignFromClientTab(page, 'Mia Mobile', 'Mobile block', 1);
      const clientPath = /\/app\/clients\/[0-9a-f-]{36}/.exec(page.url())![0];

      await page.setViewportSize({ width: 375, height: 812 });
      const screens = [
        '/app',
        '/app/review',
        '/app/clients',
        clientPath,
        `${clientPath}/check-ins`,
        `${clientPath}/calendar`,
        `${clientPath}/progress`,
        `${clientPath}/messages`,
        '/app/messages',
        '/app/check-ins',
        '/app/programs',
        programPath,
        '/app/exercises',
        '/app/support',
        '/app/more',
      ];
      for (const path of screens) {
        await test.step(path, async () => {
          await page.goto(path);
          await expect(page.locator('main h1').first()).toBeVisible({ timeout: 30_000 });
          await expectNoHorizontalOverflow(page);
          await expectNoAxeViolations(page);
          // One-handed: the primary navigation sits at the bottom of the screen.
          const nav = page.getByRole('navigation', { name: 'Primary mobile' });
          const box = await nav.boundingBox();
          expect(box, path).not.toBeNull();
          expect(box!.y + box!.height, path).toBeGreaterThan(812 - 120);
        });
      }
    } finally {
      await client.context.close();
    }
  });
});
