import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('opt-in review rules (PRD I3)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('the owner turns rules on; the weight rule needs a band; the review queue can filter by them', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/settings');
    const form = page.getByRole('form', { name: 'Review rules' });
    await expect(form).toBeVisible({ timeout: 30_000 });
    await form.getByLabel('Program ends soon').check();
    await form.getByLabel('Weight change', { exact: true }).check();
    await form.getByLabel('Weight change band (%)').fill('');
    await form.getByRole('button', { name: 'Save review rules' }).click();
    await expect(form.getByRole('alert')).toContainText('Set a percentage');
    await form.getByLabel('Weight change band (%)').fill('4');
    await form.getByRole('button', { name: 'Save review rules' }).click();
    await expect(page.getByText('Review rules saved.')).toBeVisible({ timeout: 15_000 });
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    }

    await page.reload();
    await expect(form.getByLabel('Program ends soon')).toBeChecked({ timeout: 30_000 });
    await expect(form.getByLabel('Weight change', { exact: true })).toBeChecked();
    await expect(form.getByLabel('Habit slipping')).not.toBeChecked();
    await expect(form.getByLabel('Weight change band (%)')).toHaveValue('4');

    await page.goto('/app/review');
    await expect(
      page.getByRole('link', { name: 'Program ends within 7 days with nothing planned after' }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
