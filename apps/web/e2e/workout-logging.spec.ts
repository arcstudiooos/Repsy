import { expect, test, type Page } from '@playwright/test';
import { countAudits, sessionFacts, storedSetLogs, sweepAsDue } from './support/db';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

/** Opens the next workout from the portal home and returns its session id. */
async function openNextWorkout(portal: Page): Promise<string> {
  await portal.goto('/portal');
  await portal.getByRole('link', { name: /Start workout|Continue workout/ }).click();
  await expect(portal).toHaveURL(/\/portal\/workouts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return portal.url().split('/').pop() as string;
}

async function logSet(
  portal: Page,
  exercise: string,
  set: number,
  fields: Record<string, string>,
): Promise<void> {
  const card = portal.getByRole('region', { name: exercise });
  for (const [label, value] of Object.entries(fields)) {
    await card.getByLabel(`Set ${set} ${label}`, { exact: true }).fill(value);
  }
  // Blur saves the set.
  await card.getByRole('heading', { name: exercise }).click();
  await expect(card.getByRole('group', { name: `Set ${set}` }).getByText('Synced')).toBeVisible({
    timeout: 15_000,
  });
}

test.describe('workout logging', () => {
  // Full journeys (sign-up, invite, build, assign) on a cold dev server.
  test.describe.configure({ timeout: 180_000 });

  test('client starts, logs every set and completes once despite a double tap', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Lou Logger');
    try {
      await buildProgram(page, 'Logging block', [
        [
          ['bench', 'Barbell Bench Press'],
          ['plank', 'Plank'],
        ],
      ]);
      await assignFromClientTab(page, 'Lou Logger', 'Logging block');

      const portal = client.page;
      const sessionId = await openNextWorkout(portal);
      await expect(portal.getByRole('heading', { name: 'Day 1' })).toBeVisible({ timeout: 30_000 });
      await expectNoAxeViolations(portal);
      await portal.getByRole('button', { name: 'Start workout' }).click();
      await expect(portal.getByText('In progress')).toBeVisible({ timeout: 15_000 });

      await logSet(portal, 'Barbell Bench Press', 1, { reps: '8', 'weight (kg)': '62.5' });
      await logSet(portal, 'Plank', 1, { seconds: '45' });

      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(portal);
        await expectNoHorizontalOverflow(portal);
      }
      const box = await portal.getByLabel('Set 1 reps', { exact: true }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

      await portal.getByRole('button', { name: 'Complete workout' }).click();
      const dialog = portal.getByRole('dialog', { name: 'Complete workout?' });
      await expectNoAxeViolations(portal);
      const confirm = dialog.getByRole('button', { name: 'Complete', exact: true });
      // A double tap: the second click races the first request.
      await confirm.dblclick();
      await expect(portal).toHaveURL(/\/portal\/workouts\?scope=past$/, { timeout: 15_000 });
      await expect(
        portal.getByRole('main').getByRole('link', { name: /Day 1/ }).getByText('Completed'),
      ).toBeVisible();
      expect(await countAudits(sessionId, 'session.completed')).toBe(1);

      // Reload: the finished workout shows its logs.
      await portal.goto(`/portal/workouts/${sessionId}`);
      await expect(portal.getByText('Set 1: 8 reps × 62.5 kg')).toBeVisible();
      await expect(portal.getByText('Set 1: 45s')).toBeVisible();
      await expectNoAxeViolations(portal);
    } finally {
      await client.context.close();
    }
  });

  test('a workout swept to incomplete can still be finished, and a missed one started (PR #2 review B-I3)', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Lee Late');
    try {
      await buildProgram(page, 'Late block', [
        [['bench', 'Barbell Bench Press']],
        [['bench', 'Barbell Bench Press']],
      ]);
      await assignFromClientTab(page, 'Lee Late', 'Late block', 2);

      const portal = client.page;
      const first = await openNextWorkout(portal);
      await portal.getByRole('button', { name: 'Start workout' }).click();
      await logSet(portal, 'Barbell Bench Press', 1, { reps: '5', 'weight (kg)': '60' });
      const [missed] = await sweepAsDue(first);
      expect(missed).toBeTruthy();

      // The portal home still offers to continue it, and the workout reloads open for logging.
      await portal.goto('/portal');
      await expect(portal.getByRole('link', { name: 'Continue workout' })).toBeVisible({
        timeout: 30_000,
      });
      await portal.goto(`/portal/workouts/${first}`);
      await expect(portal.getByLabel('Set 1 reps', { exact: true })).toHaveValue('5', {
        timeout: 30_000,
      });
      await portal.getByRole('button', { name: 'Complete workout' }).click();
      await portal
        .getByRole('dialog', { name: 'Complete workout?' })
        .getByRole('button', { name: 'Complete', exact: true })
        .click();
      await expect(portal).toHaveURL(/scope=past$/, { timeout: 15_000 });
      expect((await sessionFacts(first)).state).toBe('completed');

      // The missed workout can still be started late.
      await portal.goto(`/portal/workouts/${missed}`);
      await portal.getByRole('button', { name: 'Start workout' }).click();
      await expect(portal.getByText('In progress')).toBeVisible({ timeout: 15_000 });
      expect((await sessionFacts(missed!)).state).toBe('in_progress');
    } finally {
      await client.context.close();
    }
  });

  test('units round-trip in lb, and skipping with a comment', async ({
    page,
    request,
    browser,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Pam Pounds', { units: 'lb' });
    try {
      await buildProgram(page, 'Pounds block', [
        [['bench', 'Barbell Bench Press']],
        [['bench', 'Barbell Bench Press']],
      ]);
      await assignFromClientTab(page, 'Pam Pounds', 'Pounds block', 2);

      const portal = client.page;
      const first = await openNextWorkout(portal);
      await portal.getByRole('button', { name: 'Start workout' }).click();
      await logSet(portal, 'Barbell Bench Press', 1, { reps: '5', 'weight (lb)': '135' });
      expect(await storedSetLogs(first)).toEqual([{ set_index: 0, reps: 5, weight_kg: '61.235' }]);
      // Reload mid-workout: still 135 lb, not 134.9.
      await portal.reload();
      await expect(portal.getByLabel('Set 1 weight (lb)', { exact: true })).toHaveValue('135');
      await portal.getByRole('button', { name: 'Complete workout' }).click();
      await portal
        .getByRole('dialog', { name: 'Complete workout?' })
        .getByRole('button', { name: 'Complete', exact: true })
        .click();
      await expect(portal).toHaveURL(/scope=past$/, { timeout: 15_000 });

      // The second session: skip it with a comment, without starting.
      await portal.goto('/portal/workouts');
      await portal.getByRole('main').getByRole('link', { name: /Day 2/ }).click();
      await portal.getByRole('button', { name: 'Skip workout' }).click();
      const dialog = portal.getByRole('dialog', { name: 'Skip this workout?' });
      await dialog.getByLabel('Comment (optional)').fill('Travelling this week');
      await dialog.getByRole('button', { name: 'Skip workout' }).click();
      await expect(portal).toHaveURL(/scope=past$/, { timeout: 15_000 });
      await expect(
        portal.getByRole('main').getByRole('link', { name: /Day 2/ }).getByText('Skipped'),
      ).toBeVisible();
      await portal.getByRole('main').getByRole('link', { name: /Day 2/ }).click();
      await expect(portal.getByText('Travelling this week')).toBeVisible();
    } finally {
      await client.context.close();
    }
  });
});
