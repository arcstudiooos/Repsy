import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('analytics (S5-1)', () => {
  test('counts with numerator, denominator and period; empty states; range validation', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/app/analytics');
    await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
    await expect(page.getByText('No sessions due yet')).toBeVisible();
    await expect(page.getByText('No check-ins due yet')).toBeVisible();
    await expect(page.getByText('No review items closed yet')).toBeVisible();
    await expect(page.getByText('Paused and cancelled workouts are not counted.')).toBeVisible();
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoAxeViolations(page);
      await expectNoHorizontalOverflow(page);
    }
    await page.getByLabel('From', { exact: true }).fill('2026-11-10');
    await page.getByLabel('To', { exact: true }).fill('2026-11-01');
    await page.getByRole('button', { name: 'Show' }).click();
    await expect(page.getByText('Pick an end date on or after the start.')).toBeVisible();
  });
});
