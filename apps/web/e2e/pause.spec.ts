import { expect, test } from '@playwright/test';
import { countAudits } from './support/db';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const D003_TITLE = "Pause client's program?";
const D003_BODY =
  "Upcoming workouts will move forward by the pause duration. Completed workouts and existing progress will remain unchanged. The paused period won't affect adherence calculations.";

test.describe('pause and resume (S3-5)', () => {
  // A full journey (sign-up, invite, build, assign) on a cold dev server.
  test.describe.configure({ timeout: 180_000 });

  test('coach pauses, the portal shows the banner and the moved workout, coach resumes now', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Pia Pause');
    try {
      await buildProgram(page, 'Pause block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Pia Pause', 'Pause block');

      const portal = client.page;
      await portal.goto('/portal');
      // "Today" only appears on the next-workout card.
      const next = portal.locator('main');
      await expect(next.getByText('Today', { exact: true })).toBeVisible({ timeout: 30_000 });

      // The coach pauses for the default week; the dialog carries the D-003 copy verbatim.
      await page
        .getByRole('navigation', { name: 'Client sections' })
        .getByRole('link', { name: 'Overview' })
        .click();
      await expect(page).toHaveURL(/\/app\/clients\/[0-9a-f-]{36}$/);
      const clientId = new URL(page.url()).pathname.split('/')[3] as string;
      await page.getByRole('button', { name: 'Pause program' }).click();
      const dialog = page.getByRole('dialog', { name: D003_TITLE });
      await expect(dialog.getByText(D003_BODY, { exact: true })).toBeVisible();
      await expect(dialog.getByLabel('Pause starts')).not.toHaveValue('');
      await expect(dialog.getByLabel('Expected resume date')).not.toHaveValue('');
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(page);
      }
      // A resume date before the start lands on its field.
      const start = await dialog.getByLabel('Pause starts').inputValue();
      const resume = await dialog.getByLabel('Expected resume date').inputValue();
      await dialog.getByLabel('Expected resume date').fill(start);
      await dialog.getByRole('button', { name: 'Pause program' }).click();
      await expect(dialog.getByText('Pick a date after the pause starts.')).toBeVisible();
      await dialog.getByLabel('Expected resume date').fill(resume);
      await dialog.getByRole('button', { name: 'Pause program' }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect(page.getByText(/^Paused until /)).toBeVisible();
      expect(await countAudits(clientId, 'client.paused')).toBe(1);

      await page.goto('/app/clients');
      await expect(
        page.getByRole('row', { name: /Pia Pause/ }).getByText('Paused', { exact: true }),
      ).toBeVisible();

      // The portal: banner with the date, and today's workout moved a week on.
      await portal.reload();
      const banner = portal.getByRole('status').filter({ hasText: 'Program paused' });
      await expect(banner).toBeVisible({ timeout: 30_000 });
      await expect(banner.getByText(/^Expected back on .+\.$/)).toBeVisible();
      await expect(next.getByText('Today', { exact: true })).toHaveCount(0);
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(portal);
        await expectNoHorizontalOverflow(portal);
      }
      await portal.goto('/portal/workouts');
      await expect(portal.getByRole('status').filter({ hasText: 'Program paused' })).toBeVisible();

      // Resume now: the workout is back on today and the banner is gone.
      await page.goto(`/app/clients/${clientId}`);
      await page.getByRole('button', { name: 'Resume now' }).click();
      const confirm = page.getByRole('dialog', { name: "Resume Pia Pause's program today?" });
      await expect(confirm.getByText('Upcoming workouts move back to start today.')).toBeVisible();
      await confirm.getByRole('button', { name: 'Resume now' }).click();
      await expect(confirm).toBeHidden({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: 'Pause program' })).toBeVisible();

      await portal.goto('/portal');
      await expect(next.getByText('Today', { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(portal.getByText('Program paused')).toHaveCount(0);
    } finally {
      await client.context.close();
    }
  });
});
