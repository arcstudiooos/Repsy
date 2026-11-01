import { expect, test, type Page } from '@playwright/test';
import {
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

async function completeWorkout(portal: Page) {
  await portal.getByRole('button', { name: 'Complete workout' }).click();
  await portal
    .getByRole('dialog', { name: 'Complete workout?' })
    .getByRole('button', { name: 'Complete', exact: true })
    .click();
  await expect(portal).toHaveURL(/scope=past$/, { timeout: 15_000 });
}

test.describe('extra workouts (PRD D13)', () => {
  test.describe.configure({ timeout: 300_000 });

  test('a client logs a shared and a blank extra workout; both show in history as Extra', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Eve Xtra');
    const portal = client.page;
    try {
      // The coach shares a template.
      await buildProgram(page, 'Hotel workouts', [[['push-up', 'Push-Up']]]);
      await page.getByLabel('Share with clients as extra workouts').check();
      await expect(page.getByText('Shared with your clients')).toBeVisible({ timeout: 15_000 });

      // From the coach's shared workout.
      await portal.goto('/portal');
      await portal.getByRole('link', { name: 'Log an extra workout' }).click();
      await expect(portal.getByRole('heading', { name: 'Log an extra workout' })).toBeVisible({
        timeout: 30_000,
      });
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(portal);
        await expectNoAxeViolations(portal);
      }
      await portal.getByRole('button', { name: 'Start Day 1 from Hotel workouts' }).click();
      await expect(portal).toHaveURL(/\/portal\/workouts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await expect(portal.getByText('Extra', { exact: true })).toBeVisible({ timeout: 30_000 });
      const pushUps = portal.getByRole('region', { name: 'Push-Up' });
      await pushUps.getByLabel('Set 1 reps', { exact: true }).fill('20');
      await pushUps.getByRole('heading', { name: 'Push-Up' }).click();
      await expect(portal.getByText('Synced').first()).toBeVisible({ timeout: 15_000 });
      await completeWorkout(portal);

      // A blank one built from the library.
      await portal.goto('/portal/workouts/extra');
      await portal.getByLabel('Name (optional)').fill('Park run');
      await portal.getByLabel('Search exercises').fill('plank');
      await portal.getByRole('button', { name: 'Add Plank' }).click();
      await expect(portal.getByRole('list', { name: 'Your exercises' })).toContainText('Plank');
      await expectNoAxeViolations(portal);
      await portal.getByRole('button', { name: 'Start extra workout' }).click();
      await expect(portal.getByRole('heading', { name: 'Park run' })).toBeVisible({
        timeout: 30_000,
      });
      const plank = portal.getByRole('region', { name: 'Plank' });
      await plank.getByLabel('Set 1 seconds').fill('60');
      await plank.getByRole('heading', { name: 'Plank' }).click();
      await expect(portal.getByText('Synced').first()).toBeVisible({ timeout: 15_000 });
      await completeWorkout(portal);
      const history = portal.getByRole('list').filter({ hasText: 'Park run' });
      await expect(history.getByRole('listitem').filter({ hasText: 'Park run' })).toContainText(
        'Extra',
      );
      await expect(history.getByRole('listitem').filter({ hasText: 'Day 1' })).toContainText(
        'Extra',
      );

      // The coach sees both in the client's sessions, marked Extra.
      await openClientTab(page, 'Eve Xtra', 'Sessions');
      const sessions = page.getByRole('main');
      await expect(sessions.getByText('Park run')).toBeVisible({ timeout: 30_000 });
      await expect(sessions.getByText('Extra', { exact: true })).toHaveCount(2);
      await expectNoAxeViolations(page);
    } finally {
      await client.context.close();
    }
  });
});
