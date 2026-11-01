import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, onboardClient } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('coach digest preference (PRD H14)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('a coach turns on the daily digest; clients never see the choice', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Dee Digest');
    try {
      await page.goto('/settings');
      const digest = page.getByLabel(/Email me a daily digest/);
      await expect(digest).not.toBeChecked({ timeout: 30_000 });
      await digest.check();
      const section = page.locator('form').filter({ has: digest });
      await section.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Notifications saved')).toBeVisible({ timeout: 15_000 });
      await page.reload();
      await expect(page.getByLabel(/Email me a daily digest/)).toBeChecked({ timeout: 30_000 });
      await expectNoAxeViolations(page);

      await client.page.goto('/portal/profile');
      await expect(client.page.getByLabel('Email me when I get a new message')).toBeVisible({
        timeout: 30_000,
      });
      await expect(client.page.getByLabel(/daily digest/)).toHaveCount(0);
    } finally {
      await client.context.close();
    }
  });
});
