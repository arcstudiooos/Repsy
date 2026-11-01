import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('broadcast (PRD H6)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('coach broadcasts to all clients; each client gets it privately', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Bea Broadcast');
    try {
      await page.goto('/app/messages');
      await page.getByRole('button', { name: 'Broadcast' }).click();
      const dialog = page.getByRole('dialog', { name: 'Broadcast a message' });
      await expect(dialog.getByLabel('Send to')).toContainText('All active clients (1)');
      await dialog.getByLabel('Message', { exact: true }).fill('The gym is closed on Monday.');
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Send to 1 client' }).click();
      await expect(page.getByText('Sent to 1 client.')).toBeVisible({ timeout: 15_000 });
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
      }

      await client.page.goto('/portal/messages');
      await expect(client.page.getByText('The gym is closed on Monday.')).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await client.context.close();
    }
  });
});
