import { expect, test } from '@playwright/test';
import { buildProgram, expectNoAxeViolations } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('full set targets (PRD C7)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('a rep range with RIR and %1RM saves and prints', async ({ page, request }) => {
    await signUpVerifiedCoach(page, request);
    await buildProgram(page, 'Range block', [[['bench', 'Barbell Bench Press']]]);
    const set = page
      .getByRole('group', { name: 'Day 1', exact: true })
      .getByRole('group', { name: 'Barbell Bench Press' })
      .getByRole('group', { name: 'Set 1' });
    await set.getByLabel('Reps', { exact: true }).fill('10');
    await set.getByLabel('Top of range').fill('8');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(set.getByText('At least the reps.')).toBeVisible({ timeout: 15_000 });

    await set.getByLabel('Reps', { exact: true }).fill('8');
    await set.getByLabel('Top of range').fill('10');
    await set.getByLabel('RIR').fill('2');
    await set.getByLabel('% of 1RM').fill('72.5');
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Saved as version 2')).toBeVisible({ timeout: 30_000 });

    await page.goto(`${new URL(page.url()).pathname.replace(/\/edit$/, '')}/print`);
    await expect(page.getByText(/8-10 reps · 72\.5% 1RM · RIR 2/)).toBeVisible({ timeout: 30_000 });
  });
});
