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

  test('coach searches message text across conversations (PRD H17)', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Sam Search');
    try {
      const portal = client.page;
      await portal.goto('/portal/messages');
      await portal
        .getByLabel('Message', { exact: true })
        .fill('My shoulder clicks on overhead press');
      await portal.getByRole('button', { name: 'Send' }).click();
      const sent = portal.getByRole('list', { name: 'Messages' }).getByRole('listitem').first();
      await expect(sent.getByText('My shoulder clicks on overhead press')).toBeVisible({
        timeout: 15_000,
      });
      await expect(sent.getByText(/· Sent$/)).toBeVisible({ timeout: 15_000 });

      await page.goto('/app/messages');
      await page.getByRole('searchbox', { name: 'Search messages' }).fill('SHOULDER');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      const results = page.getByRole('list', { name: 'Search results' });
      await expect(results.getByText('My shoulder clicks on overhead press')).toBeVisible({
        timeout: 15_000,
      });
      await expectNoAxeViolations(page);
      await results.getByRole('link').first().click();
      await expect(page.getByRole('heading', { name: 'Sam Search', level: 2 })).toBeVisible({
        timeout: 15_000,
      });

      await page.goto('/app/messages?q=zzzz-nothing');
      await expect(page.getByText('No messages match.')).toBeVisible();
    } finally {
      await client.context.close();
    }
  });

  test('saved replies fill the first name; clients see the usual reply time (PRD H4, H16)', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Rae Reply');
    try {
      await page.goto('/settings');
      const exp = page.getByRole('form', { name: 'Reply expectations' });
      await exp.getByLabel('Usual reply time').selectOption({ label: 'Within 24 hours' });
      await exp.getByLabel('Office hours').fill('Mon-Fri 8:00-18:00');
      await exp.getByRole('button', { name: 'Save reply expectations' }).click();
      await expect(page.getByText('Reply expectations saved.')).toBeVisible({ timeout: 15_000 });
      const add = page.getByRole('form', { name: 'New saved reply' });
      await add.getByLabel('Title').fill('Great week');
      await add.getByLabel('Reply').fill('Great week {first_name}! Keep it up.');
      await add.getByRole('button', { name: 'Add saved reply' }).click();
      await expect(page.getByText('Great week {first_name}! Keep it up.')).toBeVisible({
        timeout: 15_000,
      });
      await expectNoAxeViolations(page);

      await openClientTab(page, 'Rae Reply', 'Messages');
      await page.getByLabel('Insert a saved reply').selectOption({ label: 'Great week' });
      await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
        'Great week Rae! Keep it up.',
      );

      await client.page.goto('/portal/messages');
      await expect(
        client.page.getByText(
          'Your coach usually replies within 24 hours. Office hours: Mon-Fri 8:00-18:00.',
        ),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await client.context.close();
    }
  });
});
