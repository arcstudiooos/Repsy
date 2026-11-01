import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from './helpers/journey';
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

      await page.reload();
      await page.getByLabel(`Role for ${teammate.name}`).selectOption({ label: 'Assistant' });
      await expect(page.getByLabel(`Role for ${teammate.name}`)).toHaveValue('assistant', {
        timeout: 15_000,
      });
    } finally {
      await context.close();
    }
  });
});
