import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('owner audit log (PRD A14)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the owner sees who assigned what, filtered by kind, with no content', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Aud Itor');
    try {
      await buildProgram(page, 'Audit block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Aud Itor', 'Audit block', 1);
      await page.goto('/settings');
      await page.getByRole('link', { name: 'Audit log' }).click();
      await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible({
        timeout: 30_000,
      });
      const events = page.getByRole('list', { name: 'Audit events' });
      await expect(events.getByText(/Assigned a program · Aud Itor/)).toBeVisible();
      await expect(events.getByText(/Sent an invite/)).toBeVisible();
      await page.getByRole('link', { name: 'Assignments' }).click();
      await expect(page).toHaveURL(/category=assignments/);
      await expect(events.getByText(/Sent an invite/)).toHaveCount(0);
      await expect(events.getByText(/Assigned a program/)).toBeVisible();
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }
    } finally {
      await client.context.close();
    }
  });
});
