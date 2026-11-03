import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

/**
 * PRD K10, H15 (D-013 #11): the coach opens a bookable call with a link and weekly hours and connects the test
 * calendar; the client books a time in the portal and sees the call link; the coach sees the session; the client
 * cancels it.
 */
test.describe('scheduling (PRD K10, H15)', () => {
  test.describe.configure({ timeout: 300_000 });

  test('coach sets up, client books and cancels', async ({ page, request, browser }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Bo Booker');
    try {
      await page.goto('/app/schedule');
      await expect(page.getByRole('heading', { name: 'Schedule', level: 1 })).toBeVisible({
        timeout: 30_000,
      });

      // Every day, 09:00-17:00 (a click before hydration does nothing, so retry until the rows appear).
      await expect(async () => {
        await page.getByRole('button', { name: 'Add hours' }).click();
        await expect(page.getByLabel('Day for range 1')).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 60_000 });
      for (let i = 2; i <= 7; i++) await page.getByRole('button', { name: 'Add hours' }).click();
      await expect(page.getByLabel('Day for range 7')).toHaveValue('7');
      await page.getByRole('button', { name: 'Save hours' }).click();
      await expect(page.getByText('Hours saved')).toBeVisible({ timeout: 15_000 });

      await page.getByRole('button', { name: 'New session' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Name').fill('Strategy call');
      await dialog
        .getByLabel('Call link (optional, https)')
        .fill('https://meet.example.test/strategy');
      // Clients may cancel right up to the start, so the test can cancel whichever slot it books.
      await dialog.getByLabel('Clients cancel up to (hours before)').fill('0');
      await dialog.getByRole('button', { name: 'Create session' }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect(page.getByText('Strategy call', { exact: true })).toBeVisible();

      await page.getByRole('link', { name: 'Connect Test calendar' }).click();
      await expect(page).toHaveURL(/\/app\/schedule\?calendar=ok/, { timeout: 30_000 });
      await expect(page.getByText(/Connected to/)).toBeVisible({ timeout: 15_000 });
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }

      // The client books the first open time.
      const portal = client.page;
      await portal.goto('/portal/sessions');
      await expect(portal.getByRole('heading', { name: 'Sessions', level: 1 })).toBeVisible({
        timeout: 30_000,
      });
      await expect(async () => {
        await portal.getByRole('button', { name: 'See open times' }).click();
        await expect(portal.getByRole('group').first()).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 60_000 });
      await portal.getByRole('group').first().getByRole('button').first().click();
      await portal.getByRole('button', { name: /^Book / }).click();
      await expect(portal.getByText(/^Booked: /)).toBeVisible({ timeout: 15_000 });
      await expect(portal.getByRole('link', { name: 'Join the call' })).toHaveAttribute(
        'href',
        'https://meet.example.test/strategy',
      );
      await expectNoAxeViolations(portal);

      await page.goto('/app/schedule');
      await expect(page.getByText(/· Bo Booker$/)).toBeVisible({ timeout: 30_000 });

      await portal.getByRole('button', { name: 'Cancel' }).click();
      await portal.getByRole('button', { name: 'Yes, cancel it' }).click();
      await expect(portal.getByText('Nothing booked.')).toBeVisible({ timeout: 15_000 });
    } finally {
      await client.context.close();
    }
  });
});
