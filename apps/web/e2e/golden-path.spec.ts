/**
 * Golden path (D-009 rule 2, Journeys A + C). Must pass on every PR from Sprint 2 on:
 * coach signs up with a pilot code → verifies the email → invites a client → the client accepts → the coach builds a
 * 1-week × 1-day program with 3 exercises → assigns it starting today → the client starts the workout, logs every
 * set and completes it → the coach's dashboard and review list show the completion.
 */
import { expect, test } from '@playwright/test';
import { assignFromClientTab, buildProgram, onboardClient } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const EXERCISES = [
  ['bench', 'Barbell Bench Press'],
  ['romanian', 'Romanian Deadlift'],
  ['plank', 'Plank'],
] as const;

test.describe('golden path', () => {
  test.describe.configure({ timeout: 240_000 });

  test('coach invites, assigns; client logs and completes; coach sees it', async ({
    page,
    request,
    browser,
  }) => {
    // Coach: sign up with a pilot code and verify the email from the dev sink (lands on /app).
    await signUpVerifiedCoach(page, request);

    // Coach invites; the client accepts in a second browser context.
    const client = await onboardClient(page, request, browser, 'Gale Golden');
    try {
      // Coach builds a 1-week × 1-day program with 3 exercises and assigns it from today.
      await buildProgram(page, 'Golden block', [[...EXERCISES]]);
      await assignFromClientTab(page, 'Gale Golden', 'Golden block');
      await expect(page.getByText('1 session')).toBeVisible();

      // Client: the next workout is on the portal home.
      const portal = client.page;
      await portal.goto('/portal');
      await expect(portal.getByText('Next workout')).toBeVisible();
      await portal.getByRole('link', { name: 'Start workout' }).click();
      await portal.getByRole('button', { name: 'Start workout' }).click({ timeout: 30_000 });
      await expect(portal.getByText('In progress')).toBeVisible({ timeout: 15_000 });

      // Every set of all 3 exercises, each acknowledged by the server.
      const entries: [string, Record<string, string>][] = [
        ['Barbell Bench Press', { reps: '10', 'weight (kg)': '60' }],
        ['Romanian Deadlift', { reps: '10', 'weight (kg)': '80' }],
        ['Plank', { seconds: '45' }],
      ];
      for (const [exercise, fields] of entries) {
        const card = portal.getByRole('region', { name: exercise });
        for (const [label, value] of Object.entries(fields)) {
          await card.getByLabel(`Set 1 ${label}`, { exact: true }).fill(value);
        }
        await card.getByRole('heading', { name: exercise }).click();
        await expect(card.getByText('Synced')).toBeVisible({ timeout: 15_000 });
      }
      await portal.getByRole('button', { name: 'Complete workout' }).click();
      await portal
        .getByRole('dialog', { name: 'Complete workout?' })
        .getByRole('button', { name: 'Complete', exact: true })
        .click();
      await expect(portal).toHaveURL(/\/portal\/workouts\?scope=past$/, { timeout: 15_000 });

      // Coach: the dashboard and the review list show the completion.
      await page.goto('/app');
      await expect(page.getByRole('link', { name: /New completed workouts\s*1/ })).toBeVisible();
      await page.goto('/app/review');
      const fresh = page.getByRole('region', { name: /New completed workouts/ });
      await expect(fresh.getByRole('link', { name: 'Gale Golden' })).toBeVisible();
      await fresh.getByRole('link', { name: 'Day 1' }).click();
      await expect(page.getByText('Set 1: 10 reps × 80 kg')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Set 1: 45s')).toBeVisible();
    } finally {
      await client.context.close();
    }
  });
});
