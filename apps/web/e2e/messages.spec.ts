import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('messaging (S4-4)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('coach writes, client reads and replies, coach inbox shows unread, read state updates', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Mia Message');
    try {
      await openClientTab(page, 'Mia Message', 'Messages');
      await expect(page.getByText('No messages yet. Say hello to Mia Message.')).toBeVisible();
      await page.getByLabel('Message', { exact: true }).fill('Great session on Monday!');
      await page.getByRole('button', { name: 'Send' }).click();
      const mine = page.getByRole('list', { name: 'Messages' }).getByRole('listitem').first();
      await expect(mine.getByText('Great session on Monday!')).toBeVisible({ timeout: 15_000 });
      await expect(mine.getByText(/· Sent$/)).toBeVisible();
      await expectNoAxeViolations(page);

      const portal = client.page;
      await portal.goto('/portal/messages');
      await expect(portal.getByText('Great session on Monday!')).toBeVisible({ timeout: 30_000 });
      await portal.getByLabel('Message', { exact: true }).fill('Thanks! My legs are sore.');
      await portal.getByRole('button', { name: 'Send' }).click();
      await expect(portal.getByText('Thanks! My legs are sore.')).toBeVisible({ timeout: 15_000 });
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(portal);
        await expectNoHorizontalOverflow(portal);
      }

      // The coach inbox lists the unread reply; opening it marks it read.
      await page.goto('/app/messages');
      const row = page.getByRole('navigation', { name: 'Conversations' }).getByRole('link', {
        name: /Mia Message/,
      });
      await expect(row.getByText('1 unread')).toBeVisible({ timeout: 30_000 });
      await expect(row.getByText('Thanks! My legs are sore.')).toBeVisible();
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(page);
        await expectNoHorizontalOverflow(page);
      }
      await row.click();
      await expect(page.getByRole('heading', { name: 'Mia Message' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(row.getByText('1 unread')).toHaveCount(0);
      await expectNoAxeViolations(page);

      // The client sees their reply as read.
      await portal.reload();
      const reply = portal
        .getByRole('list', { name: 'Messages' })
        .getByRole('listitem')
        .filter({ hasText: 'Thanks! My legs are sore.' });
      await expect(reply.getByText(/· Read$/)).toBeVisible({ timeout: 30_000 });
    } finally {
      await client.context.close();
    }
  });
});
