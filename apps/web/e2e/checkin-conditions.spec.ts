import { expect, test } from '@playwright/test';
import { issueCheckinNow } from './support/db';
import {
  expectNoAxeViolations,
  onboardClient,
  openClientTab,
  todayWeekday,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('conditional check-in questions (PRD F11)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('a follow-up appears only when the earlier answer matches', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Cleo Conditions');
    try {
      await openClientTab(page, 'Cleo Conditions', 'Check-ins');
      await page.getByLabel('Check-in day').selectOption({ label: todayWeekday() });
      await page.getByRole('button', { name: 'Save day' }).click();
      await expect(page.getByText('Check-in day saved')).toBeVisible({ timeout: 15_000 });
      await page.goto(
        (await page.getByRole('link', { name: 'Edit check-in questions' }).getAttribute('href'))!,
      );
      // Question 5 of the seeded template: "What got in the way this week?"
      await page
        .getByLabel('Question 5: show')
        .selectOption({ label: 'Only if “Energy this week”' });
      await page.getByLabel('Question 5 comparison').selectOption({ label: 'is at most' });
      await page.getByLabel('Question 5 matching answer').fill('2');
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Save questions' }).click();
      await expect(page.getByText('Check-in questions saved')).toBeVisible({ timeout: 15_000 });

      await issueCheckinNow('Cleo Conditions');
      const portal = client.page;
      await portal.goto('/portal');
      await portal.getByRole('link', { name: 'Fill in check-in' }).click();
      const energy = portal.getByRole('group', { name: /Energy this week/ });
      await expect(energy).toBeVisible({ timeout: 30_000 });
      const obstacles = portal.getByLabel(/What got in the way this week\?/);
      await expect(obstacles).toHaveCount(0);
      await energy.getByLabel('2').check();
      await expect(obstacles).toBeVisible();
      await obstacles.fill('A cold');
      await energy.getByLabel('4').check();
      await expect(obstacles).toHaveCount(0);
      await energy.getByLabel('1').check();
      await expect(obstacles).toHaveValue('A cold');
      await expectNoAxeViolations(portal);
      await portal.getByRole('button', { name: 'Send check-in' }).click();
      await expect(portal.getByText('Check-in sent to your coach. Thank you.')).toBeVisible({
        timeout: 15_000,
      });
      await openClientTab(page, 'Cleo Conditions', 'Check-ins');
      await expect(page.getByText('A cold')).toBeVisible({ timeout: 30_000 });
    } finally {
      await client.context.close();
    }
  });
});
