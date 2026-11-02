import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('phased programs (PRD C17, J5)', () => {
  test.describe.configure({ timeout: 300_000 });

  test('the coach queues the next phase and starts it', async ({ page, request, browser }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Pha Ses');
    try {
      await buildProgram(page, 'Hypertrophy', [[['bench', 'Barbell Bench Press']]]);
      await buildProgram(page, 'Strength', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Pha Ses', 'Hypertrophy', 1);
      await openClientTab(page, 'Pha Ses', 'Program');
      await page.getByLabel('Then run').selectOption({ label: 'Strength' });
      await page.getByLabel(/When it.s time/).selectOption({ label: 'Ask me first' });
      await page.getByRole('button', { name: 'Add to queue' }).click();
      const queue = page.getByRole('list', { name: 'Queued phases' });
      await expect(queue).toContainText('Strength', { timeout: 15_000 });
      await expect(queue).toContainText('asks you first');
      await page.goto(page.url());
      await expectNoAxeViolations(page);

      await queue.getByRole('button', { name: 'Start now: Strength' }).click();
      await expect(page.getByRole('definition').filter({ hasText: /^Strength$/ })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole('list', { name: 'Queued phases' })).toHaveCount(0);
    } finally {
      await client.context.close();
    }
  });
});
