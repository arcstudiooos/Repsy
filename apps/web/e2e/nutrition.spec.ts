import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('nutrition targets and daily log (PRD G6/G7)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('coach sets targets; the client logs today; the coach sees adherence', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Nia Nutrition');
    try {
      await openClientTab(page, 'Nia Nutrition', 'Nutrition');
      await page.getByText('Set targets', { exact: true }).click();
      const targets = page.getByRole('form', { name: 'Set targets' });
      await targets.getByLabel('Calories (kcal)').fill('2200');
      await targets.getByLabel('Protein (g)').fill('160');
      await targets.getByRole('button', { name: 'Save targets' }).click();
      await expect(page.getByText('2200 kcal')).toBeVisible({ timeout: 15_000 });
      await expectNoAxeViolations(page);

      const portal = client.page;
      await portal.goto('/portal/nutrition');
      await expect(portal.getByText('2200 kcal')).toBeVisible({ timeout: 30_000 });
      const log = portal.getByRole('form', { name: 'Log a day' });
      await log.getByLabel('Calories (kcal)').fill('2250');
      await log.getByLabel('Protein (g)').fill('150');
      await log.getByRole('button', { name: 'Save day' }).click();
      await expect(portal.getByText(/On target 1 of 1 logged days/)).toBeVisible({
        timeout: 15_000,
      });
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(portal);
        await expectNoHorizontalOverflow(portal);
      }

      await page.reload();
      await expect(page.getByText(/On target 1 of 1 logged days/)).toBeVisible({ timeout: 15_000 });
    } finally {
      await client.context.close();
    }
  });
});
