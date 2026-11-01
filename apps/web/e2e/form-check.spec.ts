import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

// An MP4 header is enough: the type is read from the bytes.
const mp4 = Buffer.concat([
  Buffer.from('\0\0\0\x18ftypisom\0\0\x02\0isomiso2', 'latin1'),
  Buffer.alloc(64),
]);

test.describe('form-check videos (PRD D10)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the client adds a video to an exercise; the coach sees it on the session', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Fio Form');
    const portal = client.page;
    try {
      await buildProgram(page, 'Form block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Fio Form', 'Form block', 1);
      const clientPath = /\/app\/clients\/[0-9a-f-]{36}/.exec(page.url())![0];

      await portal.goto('/portal');
      await portal.getByRole('link', { name: /Start workout/ }).click();
      await portal.getByRole('button', { name: 'Start workout' }).click();
      const card = portal.getByRole('region', { name: 'Barbell Bench Press' });
      await card.getByLabel('Add a form-check video for Barbell Bench Press').setInputFiles({
        name: 'bench.mp4',
        mimeType: 'video/mp4',
        buffer: mp4,
      });
      await expect(card.getByLabel('Form check 1 for Barbell Bench Press')).toBeVisible({
        timeout: 30_000,
      });
      await expectNoAxeViolations(portal);

      const sessionId = new URL(portal.url()).pathname.split('/').pop()!;
      await page.goto(`${clientPath}/sessions/${sessionId}`);
      const video = page.getByLabel('Form check 1 for Barbell Bench Press');
      await expect(video).toBeVisible({ timeout: 30_000 });
      const res = await page.request.get((await video.getAttribute('src'))!);
      expect(res.headers()['content-type']).toBe('video/mp4');
    } finally {
      await client.context.close();
    }
  });
});
