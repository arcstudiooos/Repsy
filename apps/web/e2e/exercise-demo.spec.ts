import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('exercise demo media (PRD C2, D7)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('a demo link becomes a thumbnail and a one-tap video; offline the logger says so', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Dax Demo');
    // External embeds and thumbnails are not fetched in tests.
    await page.route(/(youtube-nocookie\.com|ytimg\.com)/, (r) => r.abort());
    await client.page.route(/(youtube-nocookie\.com|ytimg\.com)/, (r) => r.abort());
    try {
      await page.goto('/app/exercises');
      await page.getByRole('button', { name: 'Add exercise' }).click();
      const dialog = page.getByRole('dialog', { name: 'Add exercise' });
      await dialog.getByLabel('Name').fill('Tempo Goblet Squat');
      await dialog.getByLabel('What is tracked').selectOption('reps_load');
      await dialog.getByLabel(/Demo video link/).fill('https://youtu.be/dQw4w9WgXcQ');
      await dialog.getByRole('button', { name: 'Add exercise' }).click();
      await expect(page.getByText('Tempo Goblet Squat added')).toBeVisible({ timeout: 15_000 });

      await page.getByLabel('Search exercises').fill('tempo goblet');
      const item = page
        .getByRole('list', { name: 'Exercises' })
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name: 'Tempo Goblet Squat' }) });
      await expect(item.locator('img')).toHaveAttribute(
        'src',
        'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        { timeout: 15_000 },
      );
      await item.getByRole('button', { name: 'Watch demo: Tempo Goblet Squat' }).click();
      await expect(item.locator('iframe[title="Demo: Tempo Goblet Squat"]')).toHaveAttribute(
        'src',
        'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      );
      await expectNoAxeViolations(page);

      await buildProgram(page, 'Demo block', [[['tempo goblet', 'Tempo Goblet Squat']]]);
      await assignFromClientTab(page, 'Dax Demo', 'Demo block', 1);
      const portal = client.page;
      await portal.goto('/portal');
      await portal.getByRole('link', { name: /Start workout/ }).click();
      await portal.getByRole('button', { name: 'Start workout' }).click();
      const card = portal.getByRole('region', { name: 'Tempo Goblet Squat' });
      await card.getByText('How to do it').click();
      await expect(
        card.getByRole('button', { name: 'Watch demo: Tempo Goblet Squat' }),
      ).toBeVisible({
        timeout: 15_000,
      });
      await expectNoAxeViolations(portal);
      await client.context.setOffline(true);
      await expect(card.getByText('Video needs a connection.')).toBeVisible();
      await client.context.setOffline(false);
    } finally {
      await client.context.close();
    }
  });

  test('a coach uploads their own MP4 demo for a custom exercise, then removes it', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/app/exercises');
    await page.getByRole('button', { name: 'Add exercise' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add exercise' });
    await dialog.getByLabel('Name').fill('Banded Hip Hinge');
    await dialog.getByLabel('What is tracked').selectOption('reps_load');
    await dialog.getByRole('button', { name: 'Add exercise' }).click();
    await expect(page.getByText('Banded Hip Hinge added')).toBeVisible({ timeout: 15_000 });
    await page.goto('/app/exercises?q=banded+hip');
    const item = page
      .getByRole('list', { name: 'Exercises' })
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'Banded Hip Hinge' }) });
    await item.getByLabel('Upload a demo video for Banded Hip Hinge').setInputFiles({
      name: 'hinge.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.concat([
        Buffer.from('\0\0\0\x18ftypisom\0\0\x02\0isomiso2', 'latin1'),
        Buffer.alloc(64),
      ]),
    });
    await item.getByRole('button', { name: 'Watch demo: Banded Hip Hinge' }).click({
      timeout: 30_000,
    });
    // L11: the player sets the MP4 src once its /playback lookup answers (no Stream in tests).
    const video = item.locator('video');
    await expect(video).toHaveAttribute('src', /./, { timeout: 15_000 });
    const src = await video.getAttribute('src');
    expect(src).toMatch(/^\/api\/v1\/media\/[0-9a-f-]{36}$/);
    expect((await page.request.get(src!)).headers()['content-type']).toBe('video/mp4');
    await page.goto('/app/exercises?q=banded+hip');
    await expectNoAxeViolations(page);

    await item.getByRole('button', { name: 'Remove video for Banded Hip Hinge' }).click();
    await expect(item.getByLabel('Upload a demo video for Banded Hip Hinge')).toBeAttached({
      timeout: 15_000,
    });
    await expect(item.getByRole('button', { name: 'Watch demo: Banded Hip Hinge' })).toHaveCount(0);
  });
});
