import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('richer exercise attributes (PRD C3)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a custom exercise with difficulty, unilateral, secondary muscles and cues', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/app/exercises');
    await page.getByRole('button', { name: 'Add exercise' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add exercise' });
    await dialog.getByLabel('Name').fill('Split Squat Pause');
    await dialog.getByLabel('What is tracked').selectOption('reps_load');
    await dialog.getByLabel('Difficulty (optional)').selectOption('intermediate');
    await dialog.getByLabel('One side at a time (unilateral)').check();
    await dialog.getByLabel(/Secondary muscles/).fill('Glutes, Adductors');
    await dialog
      .getByLabel(/Coaching cues/)
      .fill('Front shin vertical\nPause two seconds at the bottom');
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Add exercise' }).click();
    await expect(page.getByText('Split Squat Pause added')).toBeVisible({ timeout: 15_000 });

    await page.getByLabel('Search exercises').fill('split squat pause');
    const item = page
      .getByRole('list', { name: 'Exercises' })
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'Split Squat Pause' }) });
    await expect(item.getByText(/One side at a time · Intermediate/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(item.getByText('Also works: Glutes, Adductors')).toBeVisible();
    await expect(
      item.getByRole('list', { name: 'Cues for Split Squat Pause' }).getByRole('listitem'),
    ).toHaveCount(2);
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    }
  });
});
