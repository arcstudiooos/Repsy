import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const photo = Buffer.from(
  readFileSync(join(__dirname, 'fixtures', 'photo-with-exif.b64'), 'utf8'),
  'base64',
);
const localDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + days * 86_400_000),
  );

test.describe('progress photos (PRD E3, E4)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the client adds photos without metadata; the coach compares two dates', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Pia Photo');
    const portal = client.page;
    try {
      await portal.goto('/portal/progress');
      const form = portal.getByRole('form', { name: 'Add a progress photo' });
      for (const [date, pose] of [
        [localDate(-28), 'Front'],
        [localDate(0), 'Front'],
      ] as const) {
        await form.getByLabel('Pose').selectOption({ label: pose });
        await form.getByLabel('Taken on').fill(date);
        await form.getByLabel(/^Photo/).setInputFiles({
          name: 'me.jpg',
          mimeType: 'image/jpeg',
          buffer: photo,
        });
        await form.getByRole('button', { name: 'Add photo' }).click();
        await expect(portal.getByText('Photo added').first()).toBeVisible({ timeout: 15_000 });
        await portal.reload();
      }
      const imgs = portal.getByRole('list', { name: 'Photos by day' }).locator('img');
      await expect(imgs).toHaveCount(2, { timeout: 30_000 });
      // What the server stores and serves has no EXIF.
      const served = await portal.request.get((await imgs.first().getAttribute('src'))!);
      expect(served.status()).toBe(200);
      expect(served.headers()['content-type']).toBe('image/jpeg');
      expect((await served.body()).toString('latin1')).not.toContain('GPS-SECRET');
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(portal);
        await expectNoAxeViolations(portal);
      }

      await openClientTab(page, 'Pia Photo', 'Progress');
      const compare = page.getByRole('region', { name: 'Compare' });
      await expect(compare.locator('img')).toHaveCount(2, { timeout: 30_000 });
      await compare.getByLabel('Overlay').check();
      await expect(compare.getByLabel('Later photo opacity')).toBeVisible();
      await compare.getByLabel('Swipe').check();
      await expect(compare.getByLabel('Swipe between photos')).toBeVisible();
      await expectNoAxeViolations(page);
      // Another client's photo is not theirs to see.
      const other = await browser.newContext();
      const stranger = await other.newPage();
      const res = await stranger.request.get(new URL(served.url()).toString());
      expect(res.status()).not.toBe(200);
      await other.close();
    } finally {
      await client.context.close();
    }
  });
});
