import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const HEADING = /Coaching software that\s*never drops the ball\./;

test.describe('marketing landing (signed out)', () => {
  test('/ shows the landing page with working calls to action', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(HEADING);
    await expect(
      page.getByRole('link', { name: /Start your free 7-day trial/ }).first(),
    ).toHaveAttribute('href', '/signup');
    await expect(page.getByRole('link', { name: 'Log in' }).first()).toHaveAttribute(
      'href',
      '/login',
    );
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByText('Coming soon').first()).toBeVisible();
  });

  for (const width of [375, 768, 1440]) {
    test(`has no axe violations at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/');
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
    });
  }

  test('does not scroll sideways at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('with reduced motion, everything is shown at its final state', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    // Revealed content is fully opaque without needing to scroll it into view.
    const faded = await page.evaluate(
      () =>
        [...document.querySelectorAll<HTMLElement>('[data-reveal]')].filter(
          (el) => Number(getComputedStyle(el).opacity) < 1,
        ).length,
    );
    expect(faded).toBe(0);
    await expect(page.getByText('$4,860').first()).toBeAttached();
  });

  test('the pause control stops ambient motion and is remembered', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const toggle = page.getByRole('button', { name: /Pause motion/ });
    // Keyboard, not a click: in `next dev` (CI) the Next dev indicator sits bottom-left over this button.
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');
    await expect(page.getByRole('button', { name: /Play motion/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
