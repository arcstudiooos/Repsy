import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('coach-logged sessions', () => {
  // A full journey (sign-up, invite, build, assign) on a cold dev server.
  test.describe.configure({ timeout: 180_000 });

  test('coach logs a workout for the client; both see "Logged by coach"', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Cam Coached');
    try {
      await buildProgram(page, 'Coached block', [[['bench', 'Barbell Bench Press']]]);
      await openClientTab(page, 'Cam Coached', 'Sessions');
      await expect(page.getByText('No sessions yet')).toBeVisible();
      await assignFromClientTab(page, 'Cam Coached', 'Coached block');

      await openClientTab(page, 'Cam Coached', 'Sessions');
      await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible();
      await expectNoAxeViolations(page);
      await page.getByRole('link', { name: /^Log workout: Day 1/ }).click();
      await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await expect(
        page
          .getByText('You’re logging for Cam Coached.')
          .or(page.getByText("You're logging for Cam Coached.")),
      ).toBeVisible({ timeout: 30_000 });

      await page.getByRole('button', { name: 'Start workout' }).click();
      const card = page.getByRole('region', { name: 'Barbell Bench Press' });
      await card.getByLabel('Set 1 reps', { exact: true }).fill('10');
      await card.getByLabel('Set 1 weight (kg)', { exact: true }).fill('50');
      await card.getByRole('heading', { name: 'Barbell Bench Press' }).click();
      await expect(card.getByText('Synced')).toBeVisible({ timeout: 15_000 });
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(page);
        await expectNoHorizontalOverflow(page);
      }
      await page.getByRole('button', { name: 'Complete workout' }).click();
      await page
        .getByRole('dialog', { name: 'Complete workout?' })
        .getByRole('button', { name: 'Complete', exact: true })
        .click();
      await expect(page).toHaveURL(/\/sessions\?scope=past$/, { timeout: 15_000 });
      await expect(page.getByRole('heading', { name: 'Past' })).toBeVisible();
      await expect(
        page.getByRole('main').getByRole('listitem').getByText('Logged by coach'),
      ).toBeVisible();

      // The client sees the badge in their history.
      await client.page.goto('/portal/workouts?scope=past');
      const item = client.page.getByRole('main').getByRole('link', { name: /Day 1/ });
      await expect(item.getByText('Logged by coach')).toBeVisible({ timeout: 30_000 });
      await expect(item.getByText('Completed')).toBeVisible();
    } finally {
      await client.context.close();
    }
  });
});
