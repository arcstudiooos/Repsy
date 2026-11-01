import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';
import { setPlatformNotice } from './support/db';

test.describe('status, support and changelog (PRD M8, M9, M13)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a notice shows as a banner and on the status page; a coach writes to support', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    const message = `Maintenance tonight ${Date.now()}`;
    await setPlatformNotice(message);
    try {
      await page.goto('/app');
      await expect(page.getByText(message)).toBeVisible({ timeout: 30_000 });
      await page.goto('/status');
      await expect(page.getByRole('heading', { name: 'Service status' })).toBeVisible();
      await expect(page.getByRole('status')).toContainText(message);
      await expect(page.getByText('99.9%')).toBeVisible();
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }
    } finally {
      await setPlatformNotice(message, true);
    }
    await page.goto('/changelog');
    await expect(page.getByRole('heading', { name: 'Release 2' })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.goto('/app/support');
    await page.getByLabel('Topic').selectOption({ label: 'An idea or request' });
    await page.getByLabel('Message').fill('Could the calendar show habits too?');
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Send to support' }).click();
    await expect(page.getByText(/Thanks, we have your message/)).toBeVisible({ timeout: 15_000 });
  });
});
