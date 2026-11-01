import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('resource library (PRD G5)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('coach shares a link with all clients and a note with one; the client sees both', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Rae Resource');
    try {
      await page.goto('/app/resources');
      const form = page.getByRole('form', { name: 'Share a resource' });
      await expect(form).toBeVisible({ timeout: 30_000 });
      await form.getByLabel('Title').fill('Warm-up video');
      await form.getByLabel('Link (https, optional)').fill('http://example.com/warmup');
      await form.getByRole('button', { name: 'Share resource' }).click();
      await expect(form.getByText('Use a full https:// link.')).toBeVisible({ timeout: 15_000 });
      await form.getByLabel('Link (https, optional)').fill('https://example.com/warmup');
      await form.getByRole('button', { name: 'Share resource' }).click();
      const list = page.getByRole('list', { name: 'Resources' });
      await expect(list.getByRole('link', { name: /Warm-up video/ })).toBeVisible({
        timeout: 15_000,
      });

      await form.getByLabel('Title').fill('Your shopping list');
      await form.getByLabel('Text (optional)').fill('Oats, eggs, berries.');
      await form.getByLabel('Share with').selectOption('client');
      await form.getByLabel('Client', { exact: true }).selectOption({ label: 'Rae Resource' });
      await form.getByRole('button', { name: 'Share resource' }).click();
      await expect(list.getByText('Oats, eggs, berries.')).toBeVisible({ timeout: 15_000 });
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }

      await client.page.goto('/portal/resources');
      await expect(client.page.getByRole('link', { name: /Warm-up video/ })).toBeVisible({
        timeout: 30_000,
      });
      await expect(client.page.getByText('Oats, eggs, berries.')).toBeVisible();
      await expect(client.page.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
      await expectNoAxeViolations(client.page);

      await page.getByRole('button', { name: 'Remove Warm-up video' }).click();
      await expect(page.getByText('Removed Warm-up video.')).toBeVisible({ timeout: 15_000 });
      await client.page.reload();
      await expect(client.page.getByRole('link', { name: /Warm-up video/ })).toHaveCount(0, {
        timeout: 15_000,
      });
    } finally {
      await client.context.close();
    }
  });
});
