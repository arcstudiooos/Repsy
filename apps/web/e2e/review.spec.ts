import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('coach review list', () => {
  // A full journey (sign-up, invite, build, assign) on a cold dev server.
  test.describe.configure({ timeout: 180_000 });

  test('a completion shows on the dashboard and review list until marked seen', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Rio Review');
    try {
      await buildProgram(page, 'Review block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Rio Review', 'Review block');

      await page.goto('/app');
      await expect(page.getByRole('link', { name: /Due this week\s*1/ })).toBeVisible();

      // The client completes today's workout.
      const portal = client.page;
      await portal.goto('/portal');
      await portal.getByRole('link', { name: 'Start workout' }).click();
      await portal.getByRole('button', { name: 'Start workout' }).click({ timeout: 30_000 });
      await portal.getByRole('button', { name: 'Complete workout' }).click();
      await portal
        .getByRole('dialog', { name: 'Complete workout?' })
        .getByRole('button', { name: 'Complete', exact: true })
        .click();
      await expect(portal).toHaveURL(/scope=past$/, { timeout: 15_000 });

      await page.goto('/app');
      await expect(page.getByRole('link', { name: /New completed workouts\s*1/ })).toBeVisible();
      await expect(page.getByRole('link', { name: /Due this week\s*0/ })).toBeVisible();
      await page.getByRole('link', { name: /New completed workouts/ }).click();
      await expect(page).toHaveURL(/\/app\/review#new$/);
      const fresh = page.getByRole('region', { name: /New completed workouts/ });
      await expect(fresh.getByRole('link', { name: 'Rio Review' })).toBeVisible();
      await expect(fresh.getByRole('link', { name: 'Day 1' })).toHaveAttribute(
        'href',
        /\/app\/clients\/[0-9a-f-]{36}\/sessions\/[0-9a-f-]{36}$/,
      );
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(page);
        await expectNoHorizontalOverflow(page);
      }

      await fresh.getByRole('button', { name: 'Mark all as seen' }).click();
      await expect(fresh.getByText('No new completed workouts.')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('heading', { name: 'New completed workouts (0)' })).toBeVisible();
    } finally {
      await client.context.close();
    }
  });
});
