import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from './helpers/journey';

test.describe('legal pages (go-live 2026-11-06)', () => {
  for (const [path, heading] of [
    ['/terms', 'Terms of Service'],
    ['/privacy', 'Privacy Policy'],
  ] as const) {
    test(`${path} is public, readable and accessible`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'On this page' })).toBeVisible();
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }
    });
  }

  test('sign-up and log-in link to both pages', async ({ page }) => {
    await page.goto('/signup');
    const form = page.locator('form');
    await expect(form.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      '/terms',
    );
    await expect(form.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });
});
