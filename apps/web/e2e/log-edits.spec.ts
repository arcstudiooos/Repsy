import { expect, test, type Page } from '@playwright/test';
import { countAudits } from './support/db';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

async function fillAndBlur(page: Page, exercise: string, fields: Record<string, string>) {
  const card = page.getByRole('region', { name: exercise });
  for (const [label, value] of Object.entries(fields)) {
    await card.getByLabel(label, { exact: true }).fill(value);
  }
  await card.getByRole('heading', { name: exercise }).click();
}

test.describe('log edits and coach corrections (S3-4)', () => {
  // A full journey (sign-up, invite, build, assign) on a cold dev server.
  test.describe.configure({ timeout: 180_000 });

  test('client edits within 24h, the coach corrects with a reason, the client sees the marker', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Eda Editor');
    try {
      await buildProgram(page, 'Edit block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Eda Editor', 'Edit block');

      // The client logs set 1 (8 × 60 kg) and completes the workout.
      const portal = client.page;
      await portal.goto('/portal');
      await portal.getByRole('link', { name: /Start workout|Continue workout/ }).click();
      await expect(portal).toHaveURL(/\/portal\/workouts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      const sessionId = portal.url().split('/').pop() as string;
      await portal.getByRole('button', { name: 'Start workout' }).click();
      await fillAndBlur(portal, 'Barbell Bench Press', {
        'Set 1 reps': '8',
        'Set 1 weight (kg)': '60',
      });
      await expect(portal.getByText('Synced').first()).toBeVisible({ timeout: 15_000 });
      await portal.getByRole('button', { name: 'Complete workout' }).click();
      await portal
        .getByRole('dialog', { name: 'Complete workout?' })
        .getByRole('button', { name: 'Complete', exact: true })
        .click();
      await expect(portal).toHaveURL(/scope=past$/, { timeout: 15_000 });

      // Within the window: "Edit log", with the deadline.
      await portal.goto(`/portal/workouts/${sessionId}`);
      await expect(portal.getByText('Set 1: 8 reps × 60 kg')).toBeVisible({ timeout: 30_000 });
      await expect(portal.getByText(/^You can edit until .+\.$/)).toBeVisible();
      await expectNoAxeViolations(portal);
      await portal.getByRole('button', { name: 'Edit log' }).click();
      await portal
        .getByRole('region', { name: 'Barbell Bench Press' })
        .getByLabel('Set 1 reps', { exact: true })
        .fill('10');
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(portal);
        await expectNoHorizontalOverflow(portal);
      }
      const box = await portal.getByLabel('Set 1 reps', { exact: true }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await portal.getByRole('button', { name: 'Save changes' }).click();
      await expect(portal.getByText('Set 1: 10 reps × 60 kg')).toBeVisible({ timeout: 15_000 });
      await expect(portal.getByText('Edited', { exact: true })).toBeVisible();

      // The coach corrects it; a missing reason is refused first.
      await openClientTab(page, 'Eda Editor', 'Sessions');
      const clientPath = new URL(page.url()).pathname.replace(/\/sessions$/, '');
      await page.goto(`${clientPath}/sessions/${sessionId}`);
      await expect(page.getByText('Set 1: 10 reps × 60 kg')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Edited by client', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Correct log' }).click();
      await page
        .getByRole('region', { name: 'Barbell Bench Press' })
        .getByLabel('Set 1 reps', { exact: true })
        .fill('6');
      await page.getByRole('button', { name: 'Save correction' }).click();
      await expect(page.getByText('Add a reason for the correction.')).toBeVisible();
      await page.getByLabel('Reason for the correction').fill('Video shows 6 reps');
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Save correction' }).click();
      await expect(page.getByText('Set 1: 6 reps × 60 kg')).toBeVisible({ timeout: 15_000 });
      const trail = page.getByRole('region', { name: 'Log changes' });
      await expect(
        trail.getByText(/changed set 1 of Barbell Bench Press: 8 → 10 reps$/),
      ).toBeVisible();
      await expect(
        trail.getByText(/changed set 1 of Barbell Bench Press: 10 → 6 reps · Video shows 6 reps$/),
      ).toBeVisible();
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(page);
        await expectNoHorizontalOverflow(page);
      }
      expect(await countAudits(sessionId, 'session.logs_revised')).toBe(2);

      // The client sees the correction marker, never the reason.
      await portal.reload();
      await expect(portal.getByText('Set 1: 6 reps × 60 kg')).toBeVisible({ timeout: 30_000 });
      await expect(portal.getByText('Corrected by your coach')).toBeVisible();
      await expect(portal.getByText('Video shows 6 reps')).toHaveCount(0);
      await expectNoAxeViolations(portal);
    } finally {
      await client.context.close();
    }
  });
});
