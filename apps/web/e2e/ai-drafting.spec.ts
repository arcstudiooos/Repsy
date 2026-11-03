import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

/**
 * PRD I10, I14 (D-013 #14) with the fake provider: AI drafting is off until the owner turns it on; a pasted program
 * comes back as a labelled draft in the import box, with contact details removed before it was sent.
 */
test.describe('AI drafting (PRD I10, I14)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('off by default; the owner turns it on; a paste becomes a labelled draft', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/app/programs/import');
    await expect(page.getByRole('heading', { name: 'Import a program' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { name: 'Draft with AI' })).toHaveCount(0);

    await page.goto('/settings');
    const section = page.getByRole('heading', { name: 'AI drafting' });
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(async () => {
      await page.getByLabel('Turn on AI drafting').check();
      await page.getByRole('button', { name: 'Save' }).last().click();
      await expect(page.getByText('AI drafting is on')).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    await page.goto('/app/programs/import');
    await expect(page.getByRole('heading', { name: 'Draft with AI' })).toBeVisible({
      timeout: 30_000,
    });
    await page
      .getByLabel('Paste the program')
      .fill('From coach@example.test\nDay 1: Upper\n- Bench press 3x8 @ 60kg\n- Pull-up 3x6');
    await page.getByRole('button', { name: 'Tidy the pasted text into a draft' }).click();
    await expect(
      page.getByText('Drafted with AI. Check every exercise and number before saving.'),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/1 contact detail was removed/)).toBeVisible();
    const box = page.getByLabel('Paste the program');
    await expect(box).toHaveValue(/Bench press 3x8 @ 60kg/);
    await expect(box).not.toHaveValue(/coach@example\.test/);
    await expectNoAxeViolations(page);
  });
});
