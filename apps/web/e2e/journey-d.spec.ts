/**
 * Journey D (S4-3): a coach works the review queue. A sent check-in raises "New check-in sent"; the coach filters
 * to it, opens the check-in with the week before, messages the client, then resolves the item with a reason.
 */
import { expect, test } from '@playwright/test';
import { countAudits, flagIdFor, issueCheckinNow } from './support/db';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
  todayWeekday,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const CLIENT = 'Dee Dashboard';

test.describe('Journey D: the review queue', () => {
  test.describe.configure({ timeout: 180_000 });

  test('filter → open check-in with context → send message → resolve with reason → audit', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, CLIENT);
    try {
      await openClientTab(page, CLIENT, 'Check-ins');
      await page.getByLabel('Check-in day').selectOption({ label: todayWeekday() });
      await page.getByRole('button', { name: 'Save day' }).click();
      await expect(page.getByText('Check-in day saved')).toBeVisible({ timeout: 15_000 });
      await issueCheckinNow(CLIENT);

      const portal = client.page;
      await portal.goto('/portal/check-ins');
      await portal.getByRole('link', { name: /Fill in check-in/ }).click();
      await portal
        .getByRole('group', { name: /Energy this week/ })
        .getByLabel('2')
        .check();
      await portal.getByRole('button', { name: 'Send check-in' }).click();
      await expect(portal.getByText('Check-in sent to your coach. Thank you.')).toBeVisible({
        timeout: 15_000,
      });

      // The dashboard shows it first; the queue filters to it.
      await page.goto('/app');
      await expect(page.getByRole('heading', { name: 'Needs attention (1)' })).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole('link', { name: 'Open the review queue' }).click();
      await page
        .getByRole('navigation', { name: 'Filter by rule' })
        .getByRole('link', { name: 'New check-in sent' })
        .click();
      await expect(page).toHaveURL(/rule=checkin_new/);
      const card = page
        .getByRole('listitem')
        .filter({ has: page.getByRole('link', { name: CLIENT }) });
      await expect(card.getByText('Needs review')).toBeVisible({ timeout: 30_000 });
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(page);
        await expectNoHorizontalOverflow(page);
      }
      const reviewUrl = page.url();

      // The check-in in context: answers beside the week before.
      await card.getByRole('link', { name: 'New check-in sent' }).click();
      await expect(page.getByText('2 of 5')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole('region', { name: 'Week before' })).toBeVisible();

      // Message the client from the queue.
      await page.goto(reviewUrl);
      await card.getByRole('link', { name: 'Send message' }).click();
      await page.getByLabel('Message', { exact: true }).fill('Low energy this week? Let us talk.');
      await page.getByRole('button', { name: 'Send' }).click();
      await expect(page.getByText('Low energy this week? Let us talk.')).toBeVisible({
        timeout: 15_000,
      });

      // Resolve: a reason is required.
      await page.goto(reviewUrl);
      await card.getByRole('button', { name: /^Resolve: New check-in sent/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Resolve this item?' });
      await dialog.getByRole('button', { name: 'Resolve' }).click();
      await expect(dialog.getByText('Add a reason.')).toBeVisible();
      await expectNoAxeViolations(page);
      await dialog.getByLabel('Reason').fill('Messaged about energy');
      await dialog.getByRole('button', { name: 'Resolve' }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect(page.getByText('Nothing needs review right now.')).toBeVisible({
        timeout: 15_000,
      });
      const flagId = await flagIdFor(CLIENT, 'checkin_new');
      expect(await countAudits(flagId, 'review_flag.resolved')).toBe(1);

      await page.goto('/app/review?filter=closed');
      await expect(page.getByText(/Resolved .+: Messaged about energy/)).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await client.context.close();
    }
  });
});
