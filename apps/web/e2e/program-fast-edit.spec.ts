import { expect, test } from '@playwright/test';
import { buildProgram, expectNoAxeViolations } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('builder fast editing (PRD C11)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('adjust a week of loads by a percentage, then replace an exercise everywhere', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await buildProgram(page, 'Fast edit block', [[['bench', 'Barbell Bench Press']]]);
    const day1 = page.getByRole('group', { name: 'Day 1', exact: true });
    const set1 = day1
      .getByRole('group', { name: 'Barbell Bench Press' })
      .getByRole('group', { name: 'Set 1' });
    await set1.getByLabel('Load (kg)').fill('100');

    // +5% rounds to the 0.5 kg step: 105.
    await page.getByRole('button', { name: 'Adjust loads in week 1' }).click();
    const adjust = page.getByRole('dialog', { name: 'Adjust loads in week 1' });
    await expectNoAxeViolations(page);
    await adjust.getByLabel('Change (%)').fill('0');
    await adjust.getByRole('button', { name: 'Apply' }).click();
    await expect(adjust.getByRole('alert')).toContainText('not 0');
    await adjust.getByLabel('Change (%)').fill('5');
    await adjust.getByRole('button', { name: 'Apply' }).click();
    await expect(adjust).toBeHidden();
    await expect(set1.getByLabel('Load (kg)')).toHaveValue('105');

    // Replace keeps the sets when the tracking type matches.
    await page.getByRole('button', { name: 'Replace exercise' }).click();
    const replace = page.getByRole('dialog', { name: 'Replace an exercise everywhere' });
    await replace.getByLabel('Search exercises').fill('dumbbell bench');
    await replace.getByRole('button', { name: 'Use Dumbbell Bench Press' }).click();
    await expect(replace).toBeHidden();
    const swapped = day1.getByRole('group', { name: 'Dumbbell Bench Press' });
    await expect(swapped.getByRole('group', { name: 'Set 1' }).getByLabel('Load (kg)')).toHaveValue(
      '105',
    );
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Saved as version 2')).toBeVisible({ timeout: 30_000 });
  });
});
