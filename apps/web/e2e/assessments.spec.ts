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
const TITLE = 'Standing posture (side)';

test.describe('assessment photos and retests (PRD E5)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the coach asks for a posture assessment; the client adds photos and both compare them', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Ada Assess');
    const portal = client.page;
    try {
      await page.goto('/app/assessments');
      await page.getByLabel('Assessment name').fill(TITLE);
      await page.getByLabel('How to take the photo').fill('Side-on, arms relaxed.');
      await page.getByLabel('Guide lines').selectOption({ label: 'Plumb line' });
      await page.getByLabel('Retest every (weeks, 0 for once)').fill('4');
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Create assessment' }).click();
      await expect(
        page.getByRole('list', { name: 'Assessments' }).getByText(TITLE, { exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      await openClientTab(page, 'Ada Assess', 'Progress');
      await page.getByLabel('Ask for an assessment').selectOption({ label: TITLE });
      const asked = page.waitForResponse(
        (r) => r.url().includes('/assessments') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: 'Ask', exact: true }).click();
      expect((await asked).status()).toBe(201);

      await portal.goto('/portal');
      await expect(portal.getByText('Assessment photo due')).toBeVisible({ timeout: 30_000 });
      await portal.getByRole('link', { name: 'Take the photo' }).click();
      await expect(portal).toHaveURL(/\/portal\/progress$/);
      const section = portal.getByRole('region', { name: TITLE });
      await expect(section.getByText('Due now')).toBeVisible({ timeout: 30_000 });
      for (const days of [-28, 0]) {
        await section.getByLabel('Taken on').fill(localDate(days));
        await section.getByLabel(`Photo for ${TITLE}`).setInputFiles({
          name: 'me.jpg',
          mimeType: 'image/jpeg',
          buffer: photo,
        });
        await expect(section.getByAltText('Preview of the chosen photo')).toBeVisible();
        const added = portal.waitForResponse(
          (r) => r.url().includes('/photos') && r.request().method() === 'POST',
        );
        await section.getByRole('button', { name: 'Add photo' }).click();
        expect((await added).status()).toBe(201);
        await portal.reload();
      }
      await expect(section.getByText(/Next photo/)).toBeVisible({ timeout: 30_000 });
      await expect(section.getByAltText(/first photo/)).toBeVisible();
      await expect(section.getByAltText(/latest photo/)).toBeVisible();
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(portal);
        await expectNoAxeViolations(portal);
      }

      await page.reload();
      const coachSide = page.getByRole('region', { name: TITLE });
      await expect(coachSide.getByAltText(/latest photo/)).toBeVisible({ timeout: 30_000 });
      await coachSide.getByLabel(`Show guide lines on ${TITLE}`).uncheck();
      await expectNoAxeViolations(page);
    } finally {
      await client.context.close();
    }
  });
});
