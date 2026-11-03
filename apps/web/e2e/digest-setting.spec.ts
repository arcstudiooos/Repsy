import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, onboardClient } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('digest and reminder preferences (PRD H14, H13)', () => {
  test.describe.configure({ timeout: 150_000 });

  test('a coach turns on the daily digest; clients never see the choice', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Dee Digest');
    try {
      await page.goto('/settings');
      const digest = page.getByLabel(/Email me a daily digest/);
      await expect(digest).not.toBeChecked({ timeout: 30_000 });
      await digest.check();
      const section = page.locator('form').filter({ has: digest });
      await section.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Notifications saved')).toBeVisible({ timeout: 15_000 });
      await page.reload();
      await expect(page.getByLabel(/Email me a daily digest/)).toBeChecked({ timeout: 30_000 });
      await expectNoAxeViolations(page);

      await client.page.goto('/portal/profile');
      await expect(client.page.getByLabel('Email me when I get a new message')).toBeVisible({
        timeout: 30_000,
      });
      await expect(client.page.getByLabel(/daily digest/)).toHaveCount(0);

      // PRD H13, F9: reminders are the client's choice, off until turned on; coaches don't get them.
      const portal = client.page;
      const workout = portal.getByLabel(
        'On workout days at 07:00, and the day before a booked session',
      );
      await expect(workout).not.toBeChecked();
      await workout.check();
      await portal
        .locator('form')
        .filter({ has: workout })
        .getByRole('button', { name: 'Save' })
        .click();
      await expect(portal.getByText('Notifications saved')).toBeVisible({ timeout: 15_000 });
      await portal.reload();
      await expect(
        portal.getByLabel('On workout days at 07:00, and the day before a booked session'),
      ).toBeChecked({ timeout: 30_000 });
      await expect(
        portal.getByLabel("When my check-in is due and I haven't sent it, at 18:00"),
      ).not.toBeChecked();
      await expectNoAxeViolations(portal);
      await expect(
        page.getByLabel('On workout days at 07:00, and the day before a booked session'),
      ).toHaveCount(0);
    } finally {
      await client.context.close();
    }
  });
});
