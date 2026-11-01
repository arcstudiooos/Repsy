import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('readiness check (PRD D17)', () => {
  test.describe.configure({ timeout: 300_000 });

  test('the client rates how they feel before Start; the coach sees the score', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Rae Ready');
    const portal = client.page;
    try {
      await buildProgram(page, 'Ready block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Rae Ready', 'Ready block', 1);
      const clientPath = /\/app\/clients\/[0-9a-f-]{36}/.exec(page.url())![0];

      await portal.goto('/portal');
      await portal.getByRole('link', { name: /Start workout/ }).click();
      await expect(portal).toHaveURL(/\/portal\/workouts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await portal.getByText('How are you today? (optional)').click();
      const pick = (question: string, n: string) =>
        portal.getByRole('group', { name: question }).getByText(n, { exact: true }).click();
      await pick('Sleep', '4');
      await pick('Energy', '3');
      await pick('Soreness', '2');
      await pick('Stress', '5');
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(portal);
        await expectNoAxeViolations(portal);
      }
      await portal.getByRole('button', { name: 'Start workout' }).click();
      await expect(
        portal.getByText('Answer all five questions, or leave them all blank.'),
      ).toBeVisible();
      await pick('Mood', '4');
      await expect(
        portal.getByRole('group', { name: 'Mood' }).getByLabel('4', { exact: true }),
      ).toBeChecked();
      await portal.getByRole('button', { name: 'Start workout' }).click();
      await expect(portal.getByRole('region', { name: 'Barbell Bench Press' })).toBeVisible({
        timeout: 15_000,
      });
      await expect(portal.getByText(/Readiness 65\/100 · Sleep 4 · Energy 3/)).toBeVisible();

      // The coach sees it on the session.
      const sessionId = new URL(portal.url()).pathname.split('/').pop()!;
      await page.goto(`${clientPath}/sessions/${sessionId}`);
      await expect(page.getByText(/Readiness 65\/100 · Sleep 4 · Energy 3/)).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await client.context.close();
    }
  });
});
