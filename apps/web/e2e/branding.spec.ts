import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, onboardClient } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('workspace branding (PRD A6)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('owner sets an accent that passes AA; the client portal shows the workspace name and colour', async ({
    page,
    request,
    browser,
  }) => {
    const coach = await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Bo Brand');
    try {
      await page.goto('/settings');
      const form = page.getByRole('form', { name: 'Branding' });
      await expect(form).toBeVisible({ timeout: 30_000 });
      await form.getByLabel('Accent colour (hex)').fill('#ffcc00');
      await expect(form.getByText(/pick a darker colour/)).toBeVisible();
      await expect(form.getByRole('button', { name: 'Save branding' })).toBeDisabled();
      await form.getByLabel('Accent colour (hex)').fill('#7a1f5c');
      await expect(form.getByText(/White text contrast/)).toBeVisible();
      await form.getByRole('button', { name: 'Save branding' }).click();
      await expect(page.getByText('Branding saved.')).toBeVisible({ timeout: 15_000 });
      await expectNoAxeViolations(page);

      await client.page.goto('/portal');
      await expect(client.page.getByRole('banner').getByText(coach.orgName)).toBeVisible({
        timeout: 30_000,
      });
      const accent = await client.page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--k-accent').trim(),
      );
      expect(accent).toBe('#7a1f5c');
      await expectNoAxeViolations(client.page);
    } finally {
      await client.context.close();
    }
  });
});
