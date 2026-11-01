import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
  todayWeekday,
} from './helpers/journey';
import { seedSentCheckin } from './support/db';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('compare a check-in with any earlier one (PRD F6)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('coach picks an earlier check-in and sees answers side by side with scale changes', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Cleo Compare');
    try {
      // Setting a check-in day creates the template.
      await openClientTab(page, 'Cleo Compare', 'Check-ins');
      await page.getByLabel('Check-in day').selectOption({ label: todayWeekday() });
      await page.getByRole('button', { name: 'Save day' }).click();
      await expect(page.getByText('Check-in day saved')).toBeVisible({ timeout: 15_000 });
      await seedSentCheckin('Cleo Compare', 21, 2);
      await seedSentCheckin('Cleo Compare', 14, 3);
      await seedSentCheckin('Cleo Compare', 7, 5);
      await page.reload();

      const newest = page
        .getByRole('listitem')
        .filter({ hasText: 'Compare with an earlier check-in' })
        .first();
      await newest.getByText('Compare with an earlier check-in').click();
      const table = newest.getByRole('table');
      await expect(table).toBeVisible({ timeout: 15_000 });
      // Against the week before: 5 vs 3.
      await expect(table.getByRole('cell', { name: '+2' }).first()).toBeVisible();
      // Any earlier one: 5 vs 2.
      const select = newest.getByLabel('Earlier check-in');
      const options = await select.locator('option').allTextContents();
      await select.selectOption({ label: options[options.length - 1]! });
      await expect(table.getByRole('cell', { name: '+3' }).first()).toBeVisible();
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }
    } finally {
      await client.context.close();
    }
  });
});
