import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from './helpers/journey';
import { totp } from './helpers/totp';
import { E2E_PASSWORD, signUpVerifiedCoach } from './helpers/users';
import { resetRateLimits } from './support/db';

async function passwordStep(page: Page, email: string) {
  await resetRateLimits();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('two-step sign-in (PRD A8)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('a coach turns it on; sign-in then needs an app code or a one-time backup code', async ({
    page,
    request,
    browser,
  }) => {
    const coach = await signUpVerifiedCoach(page, request);
    await page.goto('/settings');
    const card = page.getByRole('form', { name: 'Set up two-step sign-in' });
    await card.getByLabel('Your password').fill(E2E_PASSWORD);
    await card.getByRole('button', { name: 'Set up two-step sign-in' }).click();
    const link = page.getByRole('link', { name: 'Open in your authenticator app' });
    await expect(link).toBeVisible({ timeout: 15_000 });
    const secret = new URL((await link.getAttribute('href'))!).searchParams.get('secret')!;
    const backup = await page
      .getByRole('list', { name: 'Backup codes' })
      .getByRole('listitem')
      .allTextContents();
    expect(backup.length).toBeGreaterThanOrEqual(8);
    await expectNoAxeViolations(page);

    const confirm = page.getByRole('form', { name: 'Confirm the code' });
    await confirm.getByLabel('Code from the app').fill('000000');
    await confirm.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByText("That code didn't work.", { exact: false })).toBeVisible({
      timeout: 15_000,
    });
    await confirm.getByLabel('Code from the app').fill(totp(secret));
    await confirm.getByRole('button', { name: 'Turn on' }).click();
    await expect(page.getByText('Two-step sign-in is on.')).toBeVisible({ timeout: 15_000 });

    // A fresh browser: the password alone is not enough.
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    try {
      await passwordStep(other, coach.email);
      for (const width of [375, 1440]) {
        await other.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(other);
        await expectNoAxeViolations(other);
      }
      await other.getByLabel('Authentication code').fill('123456');
      await other.getByRole('button', { name: 'Verify' }).click();
      await expect(other.getByText("That code didn't work. Check it and try again.")).toBeVisible();
      await other.getByLabel('Authentication code').fill(totp(secret));
      await other.getByRole('button', { name: 'Verify' }).click();
      await expect(other).toHaveURL(/\/app$/, { timeout: 30_000 });
    } finally {
      await ctx.close();
    }

    // A backup code works once.
    for (const attempt of ['first', 'again'] as const) {
      const c = await browser.newContext();
      const p = await c.newPage();
      try {
        await passwordStep(p, coach.email);
        await p.getByRole('button', { name: 'Use a backup code instead' }).click();
        await p.getByLabel('Backup code').fill(backup[0]!);
        await p.getByRole('button', { name: 'Verify' }).click();
        if (attempt === 'first') await expect(p).toHaveURL(/\/app$/, { timeout: 30_000 });
        else
          await expect(p.getByText("That code didn't work. Check it and try again.")).toBeVisible();
      } finally {
        await c.close();
      }
    }
  });
});
