import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from './helpers/journey';
import { signUpVerifiedCoach, waitForEmail } from './helpers/users';

test.describe('sign-up link (PRD B3)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('a coach makes a link; a walk-in signs up and gets an invite; the link can be turned off', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/app/clients');
    await page.getByRole('button', { name: 'Invite link' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sign-up link' });
    await dialog.getByLabel('Up to').selectOption({ label: '10 sign-ups' });
    await dialog.getByRole('button', { name: 'Make a link' }).click();
    const field = dialog.getByLabel(/Your new link/);
    await expect(field).toHaveValue(/\/join\//, { timeout: 15_000 });
    const link = await field.inputValue();
    await expectNoAxeViolations(page);

    const visitor = await browser.newContext();
    const walkIn = await visitor.newPage();
    const email = `walkin-${Date.now()}@example.test`;
    try {
      await walkIn.goto(link);
      await expect(walkIn.getByRole('heading', { name: /^Join / })).toBeVisible({
        timeout: 30_000,
      });
      for (const width of [375, 1440]) {
        await walkIn.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(walkIn);
        await expectNoAxeViolations(walkIn);
      }
      await walkIn.getByLabel('Your name').fill('Wes Walkin');
      await walkIn.getByLabel('Email').fill(email);
      await walkIn.getByRole('button', { name: 'Send me an invite' }).click();
      await expect(walkIn.getByText(/Check your email/)).toBeVisible({ timeout: 15_000 });
      const mail = await waitForEmail(request, email, 'client_invite');
      expect(mail.text).toMatch(/\/invite\//);

      // The coach sees the new invited client and the use.
      await page.keyboard.press('Escape');
      await page.reload();
      await expect(page.getByRole('link', { name: 'Wes Walkin' }).first()).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole('button', { name: 'Invite link' }).click();
      const list = page.getByRole('list', { name: 'Sign-up links' });
      await expect(list).toContainText('1 of 10 used', { timeout: 15_000 });
      await list.getByRole('button', { name: /^Turn off the link made / }).click();
      await expect(list).toContainText('closed', { timeout: 15_000 });

      await walkIn.goto(link);
      await expect(
        walkIn.getByRole('heading', { name: "This sign-up link can't be used" }),
      ).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await visitor.close();
    }
  });
});
