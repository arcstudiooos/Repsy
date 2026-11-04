import { expect, test } from '@playwright/test';

test.describe('installable portal (PRD L1)', () => {
  test('the manifest is served with icons that load, and pages link to it', async ({
    page,
    request,
  }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const manifest = (await res.json()) as {
      start_url: string;
      display: string;
      icons: { src: string; sizes: string; purpose?: string }[];
    };
    expect(manifest).toMatchObject({ start_url: '/portal', display: 'standalone' });
    expect(manifest.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512', '512x512']);
    for (const icon of manifest.icons) {
      const img = await request.get(icon.src);
      expect(img.ok()).toBe(true);
      expect(img.headers()['content-type']).toBe('image/png');
    }
    await page.goto('/login');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
      'content',
      '#101418',
    );
  });
});
