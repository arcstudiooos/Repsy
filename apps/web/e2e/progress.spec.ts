import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('personal records and exercise history (PRD E6, E7)', () => {
  // A full journey (sign-up, invite, build, assign, log) on a cold dev server.
  test.describe.configure({ timeout: 180_000 });

  test('a completed workout shows on the coach Progress tab and the client progress page', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Pat Progress');
    try {
      await buildProgram(page, 'Progress block', [[['bench', 'Barbell Bench Press']]]);
      await openClientTab(page, 'Pat Progress', 'Progress');
      await expect(page.getByRole('heading', { name: 'No records yet' })).toBeVisible();
      await assignFromClientTab(page, 'Pat Progress', 'Progress block');

      // Log 10 × 50 kg as the coach and complete the workout.
      await openClientTab(page, 'Pat Progress', 'Sessions');
      await page.getByRole('link', { name: /^Log workout: Day 1/ }).click();
      await expect(page).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await page.getByRole('button', { name: 'Start workout' }).click();
      const card = page.getByRole('region', { name: 'Barbell Bench Press' });
      await card.getByLabel('Set 1 reps', { exact: true }).fill('10');
      await card.getByLabel('Set 1 weight (kg)', { exact: true }).fill('50');
      await card.getByRole('heading', { name: 'Barbell Bench Press' }).click();
      await expect(card.getByText('Synced')).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Complete workout' }).click();
      await page
        .getByRole('dialog', { name: 'Complete workout?' })
        .getByRole('button', { name: 'Complete', exact: true })
        .click();
      await expect(page).toHaveURL(/\/sessions\?scope=past$/, { timeout: 15_000 });

      // Coach: the record row. Epley: 50 × (1 + 10/30) = 66.7.
      await openClientTab(page, 'Pat Progress', 'Progress');
      const row = page.getByRole('row', { name: /Barbell Bench Press/ });
      await expect(row.getByText('66.7 kg')).toBeVisible();
      await expect(row.getByText('estimated 1RM')).toBeVisible();
      await expect(row.getByText('50 kg × 10')).toBeVisible();
      await expectNoAxeViolations(page);

      // Client: the same record, then the exercise's history.
      await client.page.goto('/portal/progress');
      await expect(client.page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible({
        timeout: 30_000,
      });
      for (const width of [375, 1440]) {
        await client.page.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(client.page);
        await expectNoHorizontalOverflow(client.page);
      }
      await client.page
        .getByRole('main')
        .getByRole('link', { name: 'Barbell Bench Press' })
        .first()
        .click();
      await expect(
        client.page.getByRole('heading', { name: 'Barbell Bench Press', level: 1 }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(client.page.getByRole('heading', { name: 'Rep maxes' })).toBeVisible();
      await expect(client.page.getByRole('heading', { name: 'Workouts' })).toBeVisible();
      await expectNoAxeViolations(client.page);
      await expectNoHorizontalOverflow(client.page);
    } finally {
      await client.context.close();
    }
  });
});
