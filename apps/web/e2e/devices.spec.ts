import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from './helpers/journey';
import { signIn, signUpVerifiedCoach } from './helpers/users';

test.describe('sessions and devices (PRD A9)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('a second device is listed and can be signed out on its own', async ({
    page,
    request,
    browser,
  }) => {
    const coach = await signUpVerifiedCoach(page, request);
    const other = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
    });
    const otherPage = await other.newPage();
    try {
      await signIn(otherPage, coach.email, /\/app/);

      await page.goto('/settings');
      const devices = page.getByRole('list', { name: 'Signed-in devices' });
      await expect(devices.getByRole('listitem')).toHaveCount(2, { timeout: 30_000 });
      await expect(devices.getByText('(this device)')).toBeVisible();
      await expect(devices.getByText('Firefox on Windows')).toBeVisible();
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }

      await devices.getByRole('button', { name: /^Sign out Firefox on Windows/ }).click();
      await expect(page.getByText('Signed out Firefox on Windows')).toBeVisible({
        timeout: 15_000,
      });
      await expect(devices.getByRole('listitem')).toHaveCount(1, { timeout: 15_000 });

      // The other device is signed out; this one is not.
      await otherPage.goto('/app');
      await expect(otherPage).toHaveURL(/\/login/, { timeout: 30_000 });
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await other.close();
    }
  });
});
