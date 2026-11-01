import { expect, test } from '@playwright/test';
import { issueCheckinNow } from './support/db';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
  todayWeekday,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('check-in question types (PRD F3)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the coach adds a pick-one and a body measurement question; the weight reaches progress', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Fay Forms');
    try {
      await openClientTab(page, 'Fay Forms', 'Check-ins');
      await page.getByLabel('Check-in day').selectOption({ label: todayWeekday() });
      await page.getByRole('button', { name: 'Save day' }).click();
      await expect(page.getByText('Check-in day saved')).toBeVisible({ timeout: 15_000 });

      // A fresh load, so the "saved" toast is gone before the accessibility scan.
      await page.goto(
        (await page.getByRole('link', { name: 'Edit check-in questions' }).getAttribute('href'))!,
      );
      await expect(page.getByRole('heading', { name: 'Check-in questions' })).toBeVisible();
      const count = await page.getByRole('group', { name: /^Question \d+$/ }).count();
      await page.getByRole('button', { name: 'Add question' }).click();
      const n1 = count + 1;
      await page.getByLabel(`Question ${n1} text`).fill('How did training feel?');
      await page.getByLabel(`Question ${n1} answer type`).selectOption({ label: 'Pick one' });
      await page.getByLabel(`Question ${n1} options, one per line`).fill('Easy\nRight\nToo hard');
      await page.getByRole('button', { name: 'Add question' }).click();
      const n2 = count + 2;
      await page.getByLabel(`Question ${n2} text`).fill('Morning weight');
      await page
        .getByLabel(`Question ${n2} answer type`)
        .selectOption({ label: 'Body measurement' });
      await page.getByLabel(`Question ${n2} measurement`).selectOption({ label: 'Body weight' });
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Save questions' }).click();
      await expect(page.getByText('Check-in questions saved')).toBeVisible({ timeout: 15_000 });

      await issueCheckinNow('Fay Forms');
      const portal = client.page;
      await portal.goto('/portal');
      await portal.getByRole('link', { name: 'Fill in check-in' }).click();
      const feel = portal.getByRole('group', { name: /How did training feel\?/ });
      await expect(feel).toBeVisible({ timeout: 30_000 });
      await feel.getByLabel('Right').check();
      await portal.getByLabel(/Morning weight/).fill('81.4');
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(portal);
        await expectNoHorizontalOverflow(portal);
      }
      await portal.getByRole('button', { name: 'Send check-in' }).click();
      await expect(portal.getByText('Check-in sent to your coach. Thank you.')).toBeVisible({
        timeout: 15_000,
      });
      await expect(portal.getByText('81.4 kg')).toBeVisible();

      await openClientTab(page, 'Fay Forms', 'Check-ins');
      await expect(page.getByText('Right', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('81.4 kg').first()).toBeVisible();
      await openClientTab(page, 'Fay Forms', 'Progress');
      await expect(page.getByText(/81\.4/).first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await client.context.close();
    }
  });
});
