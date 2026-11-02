import { expect, test } from '@playwright/test';
import { buildProgram, expectNoAxeViolations } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('progression rules (PRD C12)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the coach previews +2.5 kg a week and applies it to the later weeks', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await buildProgram(page, 'Linear block', [[['bench', 'Barbell Bench Press']]]);
    const card = () => page.getByRole('group', { name: 'Barbell Bench Press' });
    const set1 = () => card().getByRole('group', { name: 'Set 1' });
    await set1().getByLabel('Reps', { exact: true }).fill('5');
    await set1().getByLabel('Load (kg)').fill('100');
    await page.getByRole('button', { name: 'Duplicate week 1' }).click();
    await page.getByRole('button', { name: 'Duplicate week 2' }).click();
    await page.getByRole('tab', { name: 'Week 1' }).click();

    await card().getByRole('button', { name: 'Progress Barbell Bench Press over weeks' }).click();
    const dialog = page.getByRole('dialog', { name: /Progress Barbell Bench Press/ });
    await dialog.getByLabel('Load per week (kg)').fill('2.5');
    await dialog.getByLabel('Target RPE (optional)').fill('8');
    const preview = dialog.getByRole('list', { name: 'Preview' });
    await expect(preview).toContainText('Week 2: 5 × 102.5 kg @ RPE 8');
    await expect(preview).toContainText('Week 3: 5 × 105 kg @ RPE 8');
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Apply to 2 weeks' }).click();

    await page.getByRole('tab', { name: 'Week 3' }).click();
    await expect(set1().getByLabel('Load (kg)')).toHaveValue('105');
    await expect(set1().getByLabel('RPE')).toHaveValue('8');
  });
});
