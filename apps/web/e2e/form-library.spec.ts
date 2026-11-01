import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('form library (PRD F2)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the coach makes a one-off form, sends it, and reads the answer', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Lio Library');
    try {
      await page.goto('/app/check-ins');
      const make = page.getByRole('form', { name: 'New template' });
      await make.getByLabel('Name').fill('Injury history');
      await make.getByLabel('Kind').selectOption({ label: 'One-off form' });
      await make.getByRole('button', { name: 'Create template' }).click();
      await expect(page).toHaveURL(/template=/, { timeout: 15_000 });
      await expect(
        page.getByRole('navigation', { name: 'Forms and check-ins' }).getByRole('link', {
          name: /Injury history/,
        }),
      ).toHaveAttribute('aria-current', 'page');
      await page.getByLabel('Question 1 text').fill('Any injuries I should know about?');
      await page.getByRole('button', { name: 'Save questions' }).click();
      await expect(page.getByText('Check-in questions saved')).toBeVisible({ timeout: 15_000 });
      await page.reload();
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }

      await openClientTab(page, 'Lio Library', 'Check-ins');
      await page.getByLabel('Send a form').selectOption({ label: 'Injury history' });
      await page.getByRole('button', { name: 'Send form' }).click();
      await expect(page.getByText('Form sent')).toBeVisible({ timeout: 15_000 });

      const portal = client.page;
      await portal.goto('/portal/check-ins');
      await portal.getByRole('link', { name: /^Fill in Injury history/ }).click();
      await portal.getByLabel(/Any injuries I should know about\?/).fill('Left knee, 2024.');
      await portal.getByRole('button', { name: 'Send check-in' }).click();
      await expect(portal.getByText('Check-in sent to your coach. Thank you.')).toBeVisible({
        timeout: 15_000,
      });

      await page.reload();
      await expect(page.getByRole('heading', { name: /^Injury history · sent / })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText('Left knee, 2024.')).toBeVisible();
    } finally {
      await client.context.close();
    }
  });
});
