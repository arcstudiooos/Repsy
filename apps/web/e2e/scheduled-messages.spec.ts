import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, onboardClient, openClientTab } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('scheduled messages (PRD H5)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('the coach schedules a message in the client’s time, sees it waiting, and cancels it', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Sol Schedule');
    try {
      await openClientTab(page, 'Sol Schedule', 'Messages');
      await expect(page.getByRole('heading', { name: 'Send later' })).toBeVisible({
        timeout: 30_000,
      });
      const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      await page.getByLabel('Message to send later').fill('Good luck at the meet!');
      await page.getByLabel('Date', { exact: true }).fill(tomorrow);
      await page.getByLabel('Time', { exact: true }).fill('07:30');
      await page.getByRole('button', { name: 'Schedule' }).click();
      const list = page.getByRole('list', { name: 'Scheduled messages' });
      await expect(list.getByText('Good luck at the meet!')).toBeVisible({ timeout: 15_000 });
      await expect(list.getByText(/07:30/)).toBeVisible();
      await page.goto(page.url());
      await expect(list.getByText('Good luck at the meet!')).toBeVisible({ timeout: 30_000 });
      await expectNoAxeViolations(page);
      await list.getByRole('button', { name: /Cancel the message for/ }).click();
      await expect(list).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await client.context.close();
    }
  });
});
