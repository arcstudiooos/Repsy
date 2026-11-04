import { expect, test } from '@playwright/test';
import { expectNoAxeViolations } from './helpers/journey';
import { E2E_PASSWORD, waitForEmail } from './helpers/users';
import { resetRateLimits } from './support/db';

test.describe('self-serve trial (PRD A4)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a coach signs up without a pilot code and gets a 14-day trial', async ({
    page,
    request,
  }) => {
    const email = `trial-${Date.now()}@example.test`;
    await expect(async () => {
      await resetRateLimits();
      await page.goto('/signup');
      await page.getByLabel('Your name').fill('Tia Trial');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password').fill(E2E_PASSWORD);
      await page.getByLabel('Business name').fill('Trial Gym');
      await page.getByLabel('Time zone').selectOption('Europe/London');
      await expect(page.getByText('No code? You get a free 14-day trial')).toBeVisible();
      await page.getByRole('button', { name: 'Create account' }).click();
      await expect(page).toHaveURL(/\/verify-email$/, { timeout: 20_000 });
    }).toPass({ timeout: 90_000 });
    const mail = await waitForEmail(request, email, 'auth.verify_email');
    await page.goto(/https?:\/\/\S+/.exec(mail.text)![0]);
    await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 });
    await expect(page.getByText('Free trial: 14 days left')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Up to 3 active clients during the trial.')).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('link', { name: 'See the plan' }).click();
    await expect(page.getByRole('heading', { name: 'Plan and fair-billing charter' })).toBeVisible({
      timeout: 30_000,
    });
    await expectNoAxeViolations(page);
  });
});
