import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const SAFETY = 'Tell your coach about anything that affects safe training before you begin.';

test.describe('client portal', () => {
  // A full journey (sign-up, invite, build, assign) on a cold dev server.
  test.describe.configure({ timeout: 180_000 });

  test('home shows the next workout, weekly progress and the safety reminder; list and history', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Pat Portal');
    try {
      // Before any assignment.
      await client.page.goto('/portal');
      await expect(client.page.getByText('Nothing scheduled yet')).toBeVisible();
      await expect(client.page.getByText(SAFETY)).toBeVisible();

      await buildProgram(page, 'Portal block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Pat Portal', 'Portal block');

      const portal = client.page;
      await portal.goto('/portal');
      await expect(portal.getByText(SAFETY)).toBeVisible();
      await expect(portal.getByText('Next workout')).toBeVisible();
      await expect(portal.getByText('Today', { exact: true })).toBeVisible();
      await expect(portal.getByRole('link', { name: 'Start workout' })).toBeVisible();
      await expect(portal.getByText('0 of 1 workout done')).toBeVisible();
      await expect(
        portal.getByRole('progressbar', { name: 'Workouts done this week' }),
      ).toHaveAttribute('aria-valuenow', '0');

      for (const width of [375, 768, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await portal.goto('/portal');
        await expect(portal.getByText('Next workout')).toBeVisible();
        await expectNoAxeViolations(portal);
        await expectNoHorizontalOverflow(portal);
      }

      await portal.getByRole('link', { name: 'Workouts' }).first().click();
      await expect(portal).toHaveURL(/\/portal\/workouts$/);
      await expect(portal.getByRole('link', { name: 'Upcoming' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      const item = portal.getByRole('main').getByRole('link', { name: /Today Day 1/ });
      await expect(item).toBeVisible();
      await expect(item.getByText('Scheduled', { exact: true })).toBeVisible();
      await expectNoAxeViolations(portal);
      await expectNoHorizontalOverflow(portal);

      await portal.getByRole('link', { name: 'History' }).click();
      await expect(portal).toHaveURL(/scope=past/);
      await expect(portal.getByText('No workout history yet')).toBeVisible();
      await expectNoAxeViolations(portal);
    } finally {
      await client.context.close();
    }
  });
});
