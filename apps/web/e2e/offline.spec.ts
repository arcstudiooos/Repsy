/**
 * Offline continuity (S3-3, D-004 acceptance, Review Focus #1): a workout started online is logged and completed
 * offline, survives a closed page, reopens offline from the service worker and the device store, and syncs once.
 * Runs against a production build (playwright.offline.config.ts); users are seeded, not signed up, because that
 * server keeps the breached-password check on.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { countAudits, seedCoachWithClient, sessionFacts, storedSetLogs } from './support/db';
import { assignFromClientTab, buildProgram } from './helpers/journey';
import { E2E_PASSWORD, signIn } from './helpers/users';

/** A seeded coach signed in on `page`, and their client signed in on the portal in a second context. */
async function coachAndClient(page: Page, browser: Browser, clientName: string) {
  const seeded = await seedCoachWithClient({
    coachName: 'Offline Coach',
    clientName,
    password: E2E_PASSWORD,
    // The browser's zone (the runner's), so "today" matches on both sides.
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  await signIn(page, seeded.coachEmail, /\/app/);
  const context = await browser.newContext();
  const portal = await context.newPage();
  await signIn(portal, seeded.clientEmail, /\/portal/);
  return { context, page: portal };
}

const EXERCISES = [
  ['bench', 'Barbell Bench Press'],
  ['romanian', 'Romanian Deadlift'],
] as const;

async function fillAndBlur(page: Page, exercise: string, fields: Record<string, string>) {
  const card = page.getByRole('region', { name: exercise });
  for (const [label, value] of Object.entries(fields)) {
    await card.getByLabel(label, { exact: true }).fill(value);
  }
  await card.getByRole('heading', { name: exercise }).click();
}

/** Opens today's workout from the portal home and starts it (online). Returns the session id. */
async function startToday(portal: Page): Promise<string> {
  await portal.goto('/portal');
  await portal.getByRole('link', { name: /Start workout|Continue workout/ }).click();
  await expect(portal).toHaveURL(/\/portal\/workouts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  const sessionId = portal.url().split('/').pop() as string;
  await portal.getByRole('button', { name: 'Start workout' }).click();
  await expect(portal.getByRole('region', { name: EXERCISES[0][1] })).toBeVisible({
    timeout: 30_000,
  });
  // The service worker controls the page and has stored this workout for offline use.
  await portal.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
    timeout: 30_000,
  });
  await expect
    .poll(
      () =>
        portal.evaluate(async (id) => {
          const names = await caches.keys();
          for (const name of names) {
            if (await (await caches.open(name)).match(`/portal/workouts/${id}`)) return true;
          }
          return false;
        }, sessionId),
      { timeout: 30_000 },
    )
    .toBe(true);
  return sessionId;
}

const status = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test.describe('offline continuity (S3-3)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('logs offline, survives a closed page, syncs once', async ({ page, browser }) => {
    const client = await coachAndClient(page, browser, 'Ola Offline');
    try {
      await buildProgram(page, 'Offline block', [[...EXERCISES]]);
      await assignFromClientTab(page, 'Ola Offline', 'Offline block');

      const portal = client.page;
      const sessionId = await startToday(portal);
      const url = portal.url();

      await client.context.setOffline(true);
      await fillAndBlur(portal, 'Barbell Bench Press', {
        'Set 1 reps': '8',
        'Set 1 weight (kg)': '60',
      });
      await fillAndBlur(portal, 'Romanian Deadlift', {
        'Set 1 reps': '10',
        'Set 1 weight (kg)': '80',
      });
      await expect(portal.getByText('Saved on device').first()).toBeVisible();
      await portal.getByRole('button', { name: 'Complete workout' }).click();
      await portal
        .getByRole('dialog', { name: 'Complete workout?' })
        .getByRole('button', { name: 'Complete', exact: true })
        .click();
      await expect(status(portal, 'Saved on device')).toBeVisible({ timeout: 15_000 });
      expect((await sessionFacts(sessionId)).state).toBe('in_progress');

      // Close the page; a new one opens the workout offline from the worker and the device store.
      await portal.close();
      const reopened = await client.context.newPage();
      await reopened.goto(url);
      await expect(reopened.getByText('Set 1: 8 reps × 60 kg')).toBeVisible({ timeout: 30_000 });
      await expect(reopened.getByText('Set 1: 10 reps × 80 kg')).toBeVisible();
      await expect(status(reopened, 'Saved on device')).toBeVisible();

      await client.context.setOffline(false);
      await expect(status(reopened, 'Synced')).toBeVisible({ timeout: 45_000 });

      const facts = await sessionFacts(sessionId);
      expect(facts).toMatchObject({ state: 'completed', rows: 2, onLocked: 2 });
      expect(await countAudits(sessionId, 'session.completed')).toBe(1);
      expect((await storedSetLogs(sessionId)).map((r) => [r.reps, r.weight_kg]).sort()).toEqual(
        [
          [10, '80.000'],
          [8, '60.000'],
        ].sort(),
      );
    } finally {
      await client.context.close();
    }
  });

  test('coach commit while offline: sync lands on the locked version', async ({
    page,
    browser,
  }) => {
    const client = await coachAndClient(page, browser, 'Cora Commit');
    try {
      await buildProgram(page, 'Commit block', [[...EXERCISES]]);
      await assignFromClientTab(page, 'Cora Commit', 'Commit block');

      const portal = client.page;
      const sessionId = await startToday(portal);
      const locked = (await sessionFacts(sessionId)).workoutVersionId;
      expect(locked).not.toBeNull();
      await client.context.setOffline(true);
      await fillAndBlur(portal, 'Barbell Bench Press', {
        'Set 1 reps': '5',
        'Set 1 weight (kg)': '70',
      });
      await expect(portal.getByText('Saved on device').first()).toBeVisible();

      // Meanwhile the coach changes that workout in the client's program (a new version).
      await page.getByRole('link', { name: 'Edit program' }).click();
      await expect(page).toHaveURL(/\/app\/programs\/[0-9a-f-]{36}\/edit$/, { timeout: 30_000 });
      await page
        .getByRole('group', { name: 'Day 1', exact: true })
        .getByLabel('Day title')
        .fill('Changed day');
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await page
        .getByRole('dialog', { name: "Save changes to Cora Commit's program?" })
        .getByRole('button', { name: 'Save changes' })
        .click();
      await expect(page.getByText('Saved as version 2')).toBeVisible({ timeout: 30_000 });

      await client.context.setOffline(false);
      await expect(portal.getByText('Synced').first()).toBeVisible({ timeout: 45_000 });
      expect(await sessionFacts(sessionId)).toMatchObject({
        state: 'in_progress',
        workoutVersionId: locked,
        rows: 1,
        onLocked: 1,
      });
    } finally {
      await client.context.close();
    }
  });

  test("uncached session can't start offline", async ({ page, browser }) => {
    const client = await coachAndClient(page, browser, 'Una Uncached');
    try {
      await buildProgram(page, 'Uncached block', [[EXERCISES[0]]]);
      await assignFromClientTab(page, 'Una Uncached', 'Uncached block');
      const portal = client.page;
      await portal.goto('/portal');
      await portal.getByRole('link', { name: /Start workout/ }).click();
      await expect(portal).toHaveURL(/\/portal\/workouts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await expect(portal.getByRole('button', { name: 'Start workout' })).toBeEnabled();
      await client.context.setOffline(true);
      await expect(portal.getByRole('button', { name: 'Start workout' })).toBeDisabled();
      await expect(
        portal.getByText("You're offline. Open this workout while online to start it."),
      ).toBeVisible();
    } finally {
      await client.context.close();
    }
  });
});
