import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('program import from text (PRD C14)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('coach pastes a plan, fixes the matches, and gets a saved template', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/app/programs/import');
    await expect(page.getByRole('heading', { name: 'Import a program' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByLabel('Program title').fill('Pasted block');
    await page
      .getByLabel('Paste the program')
      .fill(
        [
          'Day 1: Upper',
          'Barbell bench press 3x8 @ 60kg',
          'Mystery move 3x10',
          'Day 2: Lower',
          'Back squat 5x5 @ 100kg',
          'Plank 3x10',
          'Lunges forever',
        ].join('\n'),
      );
    await page.getByRole('button', { name: 'Read program' }).click();
    await expect(page.getByRole('heading', { name: 'Check the exercises' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Line 7: Add sets and reps, like 3x8.')).toBeVisible();
    await expect(page.getByText('Line 6: This exercise needs a time (like 3x45s).')).toBeVisible();
    await expect(page.getByLabel('Exercise for line 2: Barbell bench press')).toHaveValue(/.+/);
    await expect(
      page.getByRole('button', { name: 'Create program (2 of 5 exercises)' }),
    ).toBeVisible();
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    }

    // Leaving one out updates the count.
    await page.getByLabel('Exercise for line 5: Back squat').selectOption('');
    await expect(
      page.getByRole('button', { name: 'Create program (1 of 5 exercises)' }),
    ).toBeVisible();
    await page.getByLabel('Exercise for line 5: Back squat').selectOption({ label: 'Back Squat' });
    await page.getByRole('button', { name: 'Create program (2 of 5 exercises)' }).click();
    await expect(page).toHaveURL(/\/app\/programs\/[0-9a-f-]{36}\/edit$/, { timeout: 30_000 });
    await expect(page.getByLabel('Your program').getByLabel('Program title')).toHaveValue(
      'Pasted block',
    );
    await expect(page.getByText('2 days per week')).toBeVisible();
  });
});
