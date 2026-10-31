import { expect, test } from '@playwright/test';
import { issueCheckinNow } from './support/db';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
  todayWeekday,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('weekly check-ins (S4-1)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('coach schedules and edits, client fills in with an autosaved draft, coach reads it', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Cid Checkin');
    try {
      // The coach picks today's weekday on the client's Check-ins tab.
      await openClientTab(page, 'Cid Checkin', 'Check-ins');
      await expect(page.getByText('No check-ins yet')).toBeVisible();
      await page.getByLabel('Check-in day').selectOption({ label: todayWeekday() });
      await page.getByRole('button', { name: 'Save day' }).click();
      await expect(page.getByText('Check-in day saved')).toBeVisible({ timeout: 15_000 });
      await expectNoAxeViolations(page);
      const clientCheckins = page.url();

      // The coach edits the seeded questions.
      await page.getByRole('link', { name: 'Edit check-in questions' }).click();
      await expect(page.getByRole('heading', { name: 'Check-in questions' })).toBeVisible();
      await page.getByLabel('Question 1 text').fill('Energy level this week');
      await page.getByRole('button', { name: 'Save questions' }).click();
      await expect(page.getByText('Check-in questions saved')).toBeVisible({ timeout: 15_000 });
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(page);
        await expectNoHorizontalOverflow(page);
      }

      await issueCheckinNow('Cid Checkin');

      // The client opens it from the portal home and answers two questions.
      const portal = client.page;
      await portal.goto('/portal');
      await portal.getByRole('link', { name: 'Fill in check-in' }).click();
      await expect(portal.getByRole('heading', { name: 'Weekly check-in' })).toBeVisible({
        timeout: 30_000,
      });
      const energy = portal.getByRole('group', { name: /Energy level this week/ });
      await energy.getByLabel('4').check();
      await portal.getByLabel(/What got in the way this week\?/).fill('Travel for work');
      await expect(portal.getByText('Draft saved', { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // The draft survives a reload.
      await portal.reload();
      await expect(energy.getByLabel('4')).toBeChecked({ timeout: 30_000 });
      await expect(portal.getByLabel(/What got in the way this week\?/)).toHaveValue(
        'Travel for work',
      );
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(portal);
        await expectNoHorizontalOverflow(portal);
      }
      await portal.getByRole('button', { name: 'Send check-in' }).click();
      await expect(portal.getByText('Check-in sent to your coach. Thank you.')).toBeVisible({
        timeout: 15_000,
      });
      await expect(portal.getByText('4 of 5')).toBeVisible();

      // The coach sees the answers beside the week before.
      await page.goto(clientCheckins);
      await expect(page.getByText('Submitted')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('4 of 5')).toBeVisible();
      await expect(page.getByText('Travel for work')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Week before' })).toBeVisible();
      await expectNoAxeViolations(page);

      // PRD I8: the dashboard lists it as waiting for review.
      await page.goto('/app');
      await expect(page.getByText('Check-ins waiting for your review (1)')).toBeVisible({
        timeout: 30_000,
      });
      await expectNoAxeViolations(page);
      await page.getByRole('link', { name: /^Review .*check-in$/ }).click();
      await expect(page).toHaveURL(/\/check-ins$/, { timeout: 15_000 });

      // PRD F14: the coach marks it reviewed; the client sees it (and their on-time streak, F13).
      await page.getByRole('button', { name: /^Mark as reviewed: check-in of / }).click();
      await expect(page.getByText(/· Reviewed /)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('On-time streak:')).toBeVisible();
      await portal.goto('/portal/check-ins');
      await expect(portal.getByText('Your coach reviewed this')).toBeVisible({ timeout: 30_000 });
      await expect(portal.getByText('1 on time in a row. Keep it going.')).toBeVisible();
      await page.goto('/app');
      await expect(page.getByText(/Check-ins waiting for your review/)).toHaveCount(0);
    } finally {
      await client.context.close();
    }
  });
});
