/**
 * Journey E (S5-3): a client asks for deletion, a platform admin verifies it, the worker deletes the client's data
 * in that workspace, and the client's access there ends. Non-admins never see the admin console.
 */
import { expect, test } from '@playwright/test';
import { makePlatformAdmin } from './support/db';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('Journey E: deletion', () => {
  // The worker runs verified deletions every minute.
  test.describe.configure({ timeout: 240_000 });

  test('request → verify → deleted; /admin is 404 for non-admins', async ({
    page,
    request,
    browser,
  }) => {
    const coach = await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Del Deleted');
    try {
      const notAdmin = await page.goto('/admin');
      expect(notAdmin?.status()).toBe(404);

      const portal = client.page;
      await portal.goto('/portal/profile');
      await portal.getByRole('button', { name: 'Request deletion' }).click();
      const dialog = portal.getByRole('dialog', { name: 'Delete your data in this workspace?' });
      await expectNoAxeViolations(portal);
      await dialog.getByRole('button', { name: 'Request deletion' }).click();
      await expect(
        portal.getByText('Deletion requested. Kinetic will verify it, then delete the data.'),
      ).toBeVisible({ timeout: 15_000 });

      // The coach (made a platform admin for this test) works the queue.
      await makePlatformAdmin(coach.email);
      await page.goto('/admin');
      await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible({
        timeout: 30_000,
      });
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(page);
        await expectNoHorizontalOverflow(page);
      }
      await page.getByRole('button', { name: 'Verify and run' }).click();
      await expect(page.getByText(/^verified/)).toBeVisible({ timeout: 15_000 });
      await expect(async () => {
        await page.reload();
        await expect(page.getByText(/^done/)).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 150_000 });

      // The client had no other workspace: their account was anonymized and signed out everywhere.
      await portal.goto('/portal');
      await expect(portal).toHaveURL(/\/login/, { timeout: 30_000 });
      await page.goto('/app/clients');
      await expect(page.getByRole('link', { name: 'Deleted client' })).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await client.context.close();
    }
  });
});
