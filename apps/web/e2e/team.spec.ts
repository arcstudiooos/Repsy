import { expect, test } from '@playwright/test';
import {
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach, waitForEmail } from './helpers/users';

test.describe('team roles and invites (PRD A10)', () => {
  test.describe.configure({ timeout: 300_000 });

  test('the owner invites a coach, who joins with the emailed link', async ({
    page,
    request,
    browser,
  }) => {
    const owner = await signUpVerifiedCoach(page, request);
    const context = await browser.newContext();
    const other = await context.newPage();
    try {
      const teammate = await signUpVerifiedCoach(other, request);
      await page.goto('/app/team');
      await page.getByLabel('Email').fill(teammate.email);
      await page.getByLabel('Role', { exact: true }).selectOption({ label: 'Coach' });
      await page.getByRole('button', { name: 'Send invite' }).click();
      await expect(page.getByRole('list', { name: 'Open invites' })).toContainText(teammate.email, {
        timeout: 15_000,
      });
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }

      const mail = await waitForEmail(request, teammate.email, 'team_invite');
      const link = /https?:\/\/\S+\/team\/join\/\S+/.exec(mail.text)?.[0];
      expect(link).toBeTruthy();
      await other.goto(new URL(link!).pathname);
      await other.getByRole('button', { name: `Join ${owner.orgName}` }).click();
      await expect(other).toHaveURL(/\/select-org/, { timeout: 30_000 });
      await other
        .getByRole('button', { name: new RegExp(owner.orgName) })
        .first()
        .click();
      await expect(other).toHaveURL(/\/app$/, { timeout: 30_000 });
      await other.goto('/app/team');
      await expect(other.getByRole('list', { name: 'Team' })).toContainText(owner.name);
      await expect(other.getByRole('list', { name: 'Team' })).toContainText('Coach');

      // PRD C20: the owner publishes a house template; the coach sees it but can't edit it.
      await buildProgram(page, 'House plan', [[['bench', 'Barbell Bench Press']]]);
      const housed = page.waitForResponse((r) => r.url().endsWith('/house') && r.ok());
      await page.getByLabel('House template for the whole team').check();
      await housed;
      await other.goto('/app/programs');
      const row = other.getByRole('link', { name: /House plan/ });
      await expect(row).toContainText('House', { timeout: 30_000 });
      await row.click();
      await expect(other.getByText(/This is a house template/)).toBeVisible({ timeout: 30_000 });

      // PRD A13: the new coach covers the owner today; the owner's client shows under their My clients.
      const client = await onboardClient(page, request, browser, 'Cov Ered');
      try {
        await page.goto('/app/team');
        const today = new Date().toISOString().slice(0, 10);
        const later = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
        const cover = page
          .getByRole('heading', { name: 'Cover and holidays' })
          .locator('..')
          .locator('..');
        await cover.getByLabel('Covered by').selectOption({ index: 1 });
        await cover.getByLabel('From').fill(today);
        await cover.getByLabel('Until (last day)').fill(later);
        await cover.getByRole('button', { name: 'Set cover' }).click();
        await expect(page.getByRole('list', { name: 'Cover' })).toContainText('covers', {
          timeout: 15_000,
        });
        await other.goto('/app/clients');
        await expect(other.getByRole('link', { name: 'Cov Ered' }).first()).toBeVisible({
          timeout: 30_000,
        });
        await client.page.goto('/portal');
        await expect(client.page.getByText(/is away until/)).toBeVisible({ timeout: 30_000 });

        // PRD A11: the owner moves the client to the new coach.
        await page.goto('/app/clients?scope=all');
        await page.getByRole('link', { name: 'Cov Ered' }).first().click();
        const moved = page.waitForResponse((r) => r.url().endsWith('/coach') && r.ok());
        await page.getByLabel('Coach', { exact: true }).selectOption({ index: 1 });
        await moved;
      } finally {
        await client.context.close();
      }

      await page.goto('/app/team');
      await page.getByLabel(`Role for ${teammate.name}`).selectOption({ label: 'Assistant' });
      await expect(page.getByLabel(`Role for ${teammate.name}`)).toHaveValue('assistant', {
        timeout: 15_000,
      });
    } finally {
      await context.close();
    }
  });
});
