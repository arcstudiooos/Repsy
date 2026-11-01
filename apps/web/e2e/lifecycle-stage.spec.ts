import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, onboardClient } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('client lifecycle stage (PRD B20)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the coach sets a stage and filters the client list by it', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Ren Ewal');
    try {
      await page.goto('/app/clients');
      await page.getByRole('link', { name: 'Ren Ewal' }).first().click();
      const stage = page.getByLabel('Stage', { exact: true });
      await expect(stage).toHaveValue('onboarding', { timeout: 30_000 });
      // PRD I4: the client opened the portal while onboarding, so this week has a visit day.
      const thisWeek = page.getByRole('row', { name: /so far/ });
      await expect(thisWeek.getByRole('cell').last()).toHaveText('33%');
      const saved = page.waitForResponse((r) => r.url().endsWith('/stage') && r.ok());
      await stage.selectOption({ label: 'At renewal' });
      await saved;
      await page.goto('/app/clients');
      await page.getByLabel('Filter by stage').selectOption({ label: 'At renewal' });
      await expect(page).toHaveURL(/stage=at_renewal/);
      await expect(page.getByRole('link', { name: 'Ren Ewal' }).first()).toBeVisible();
      await page.getByLabel('Filter by stage').selectOption({ label: 'Onboarding' });
      await expect(page).toHaveURL(/stage=onboarding/);
      await expect(page.getByRole('link', { name: 'Ren Ewal' })).toHaveCount(0, {
        timeout: 15_000,
      });
      await page.goto('/app/clients?stage=at_renewal');
      await expectNoAxeViolations(page);
    } finally {
      await client.context.close();
    }
  });
});
