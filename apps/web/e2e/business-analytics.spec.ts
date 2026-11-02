import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('business analytics (PRD I7)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('ending coaching records a reason that shows in business analytics', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Eli Ending');
    await client.context.close();

    await page.goto('/app/analytics/business');
    await expect(page.getByText('Clients now')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('No one has left in the last 12 months.')).toBeVisible();

    await openClientTab(page, 'Eli Ending', 'History');
    await page.getByRole('button', { name: 'End coaching' }).click();
    const dialog = page.getByRole('dialog', { name: 'End coaching for Eli Ending?' });
    await dialog.getByLabel('Why is coaching ending? (optional)').selectOption({ label: 'Cost' });
    await expectNoAxeViolations(page);
    const ended = page.waitForResponse((r) => r.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: 'End coaching' }).click();
    expect((await ended).status()).toBe(200);
    await expect(page.getByRole('button', { name: 'Restore client' })).toBeVisible({
      timeout: 15_000,
    });

    await page.goto('/app/analytics/business');
    const reasons = page.getByRole('list', { name: 'Reasons' });
    await expect(reasons.getByText('Cost')).toBeVisible({ timeout: 15_000 });
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    }

    await openClientTab(page, 'Eli Ending', 'History');
    await page.getByRole('button', { name: 'Restore client' }).click();
    await expect(page.getByRole('button', { name: 'End coaching' })).toBeVisible({
      timeout: 15_000,
    });
  });
});
