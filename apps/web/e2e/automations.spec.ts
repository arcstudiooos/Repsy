import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('automations (PRD J1-J3, J7-J9)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the coach builds one from a template and starts it for a client', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Aut O');
    try {
      await page.goto('/app/automations');
      await page.getByRole('link', { name: 'Re-engagement' }).click();
      await expect(page.getByLabel('Name')).toHaveValue('Re-engagement', { timeout: 30_000 });
      await page.getByLabel('Name').fill('Win-back');
      await expect(page.getByLabel('Step 1 message')).toHaveValue(/Haven/);
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }
      await page.getByRole('button', { name: 'Save automation' }).click();
      await expect(page).toHaveURL(/\/app\/automations$/, { timeout: 30_000 });
      await expect(page.getByRole('list', { name: 'Automations' })).toContainText('Win-back');
      await expect(page.getByRole('list', { name: 'Automations' })).toContainText('2 steps');

      await openClientTab(page, 'Aut O', 'History');
      await page.getByLabel('Start an automation').selectOption({ label: 'Win-back' });
      await page.getByRole('button', { name: 'Start', exact: true }).click();
      const run = page.getByRole('region', { name: 'Win-back run' });
      await expect(run).toContainText('running', { timeout: 15_000 });
      await expect(run).toContainText('Message');
      await expect(run).toContainText('Scheduled');
      await page.goto(page.url());
      await expectNoAxeViolations(page);
      await run.getByRole('button', { name: 'Stop Win-back' }).click();
      await expect(run).toContainText('cancelled', { timeout: 15_000 });
    } finally {
      await client.context.close();
    }
  });
});
