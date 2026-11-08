/**
 * Offline continuity (S3-3, D-004 acceptance, Review Focus #1): a workout started online is logged and completed
 * offline, survives a closed page, reopens offline from the service worker and the device store, and syncs once.
 * Runs against a production build (playwright.offline.config.ts); users are seeded, not signed up, because that
 * server keeps the breached-password check on.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  countAudits,
  endSessionsOf,
  resetRateLimits,
  seedCoachWithClient,
  sessionFacts,
  storedSetLogs,
} from './support/db';
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
  // Back-to-back specs sign in more often than Better Auth's per-IP sign-in limit allows (3 per 10 s).
  await resetRateLimits();
  await signIn(page, seeded.coachEmail, /\/app/);
  const context = await browser.newContext();
  const portal = await context.newPage();
  await signIn(portal, seeded.clientEmail, /\/portal/);
  return { context, page: portal, email: seeded.clientEmail };
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
  // The asset cache is named after this build (the worker is registered as /sw.js?build=<id>), not a fixed version.
  const assetCaches = (await portal.evaluate(() => caches.keys())).filter((n) =>
    n.startsWith('repsy-assets-'),
  );
  expect(assetCaches).toHaveLength(1);
  expect(assetCaches[0]).not.toMatch(/^repsy-assets-(v1|dev)$/);
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

  test('a workout finished offline syncs from the portal home, without reopening it (I3)', async ({
    page,
    browser,
  }) => {
    const client = await coachAndClient(page, browser, 'Hana Home');
    try {
      await buildProgram(page, 'Home block', [[EXERCISES[0]]]);
      await assignFromClientTab(page, 'Hana Home', 'Home block');
      const portal = client.page;
      const sessionId = await startToday(portal);

      await client.context.setOffline(true);
      await fillAndBlur(portal, 'Barbell Bench Press', {
        'Set 1 reps': '6',
        'Set 1 weight (kg)': '50',
      });
      await portal.getByRole('button', { name: 'Complete workout' }).click();
      await portal
        .getByRole('dialog', { name: 'Complete workout?' })
        .getByRole('button', { name: 'Complete', exact: true })
        .click();
      await expect(status(portal, 'Saved on device')).toBeVisible({ timeout: 15_000 });

      // Home, still offline (from the worker's cache), then the connection returns: the portal sends it.
      await portal.goto('/portal');
      await client.context.setOffline(false);
      await expect
        .poll(async () => (await sessionFacts(sessionId)).state, { timeout: 45_000 })
        .toBe('completed');
      expect(await sessionFacts(sessionId)).toMatchObject({ rows: 1 });
      expect(portal.url()).toMatch(/\/portal$/);
    } finally {
      await client.context.close();
    }
  });

  test("sign-out deletes the device's workout data; offline, the next visitor sees none of it (C1)", async ({
    page,
    browser,
  }) => {
    const client = await coachAndClient(page, browser, 'Sami Shared');
    try {
      await buildProgram(page, 'Shared block', [[EXERCISES[0]]]);
      await assignFromClientTab(page, 'Sami Shared', 'Shared block');
      const portal = client.page;
      const sessionId = await startToday(portal);
      const url = portal.url();

      await client.context.setOffline(true);
      await fillAndBlur(portal, 'Barbell Bench Press', {
        'Set 1 reps': '7',
        'Set 1 weight (kg)': '55',
      });
      await expect(portal.getByText('Saved on device').first()).toBeVisible();

      // Back online, but the set still can't reach the server: it stays unsynced on the device.
      await client.context.route('**/api/v1/sessions/*/logs', (route) => route.abort());
      await client.context.setOffline(false);
      await portal.goto('/portal/profile');
      await portal.getByRole('button', { name: 'Sign out', exact: true }).click();
      const confirm = portal.getByRole('dialog', { name: 'Sign out anyway?' });
      await expect(confirm).toContainText("You have workout changes that haven't synced yet.");
      await confirm.getByRole('button', { name: 'Stay signed in' }).click();
      await expect(confirm).toBeHidden();
      await expect(portal).toHaveURL(/\/portal\/profile$/);

      await portal.getByRole('button', { name: 'Sign out', exact: true }).click();
      await confirm.getByRole('button', { name: 'Sign out anyway' }).click();
      await expect(portal).toHaveURL(/\/login/, { timeout: 30_000 });

      // Nothing of the workout is left on the device: no stored pages, no device store.
      const left = await portal.evaluate(async (path) => {
        const pages: string[] = [];
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          if ((await cache.match(path)) || (await cache.match('/portal'))) pages.push(name);
        }
        const dbs = (await indexedDB.databases()).map((d) => d.name);
        return { pages, dbs };
      }, `/portal/workouts/${sessionId}`);
      expect(left.pages).toEqual([]);
      expect(left.dbs).not.toContain('repsy-offline');

      // A signed-out visitor, offline, opening the workout (e.g. from history) gets nothing of it.
      await client.context.setOffline(true);
      for (const path of [url, '/portal']) {
        await portal.goto(path).catch(() => undefined);
        await expect(portal.getByText('Barbell Bench Press')).toHaveCount(0);
        await expect(portal.getByText('Shared block')).toHaveCount(0);
      }
      expect((await sessionFacts(sessionId)).rows).toBe(0);
    } finally {
      await client.context.close();
    }
  });

  test('a session ended elsewhere: the next online portal visit deletes the stored pages (PR #2 re-review)', async ({
    page,
    browser,
  }) => {
    const client = await coachAndClient(page, browser, 'Erin Expired');
    try {
      await buildProgram(page, 'Expired block', [[EXERCISES[0]]]);
      await assignFromClientTab(page, 'Erin Expired', 'Expired block');
      const portal = client.page;
      const sessionId = await startToday(portal);
      const url = portal.url();

      // The session ends without this device signing out (expiry, a password reset elsewhere).
      await endSessionsOf(client.email);
      await portal.goto('/portal');
      await expect(portal).toHaveURL(/\/login/, { timeout: 30_000 });
      const stored = await portal.evaluate(async (path) => {
        const pages: string[] = [];
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          if ((await cache.match(path)) || (await cache.match('/portal'))) pages.push(name);
        }
        return pages;
      }, `/portal/workouts/${sessionId}`);
      expect(stored).toEqual([]);

      // Offline, the workout page is no longer served from the device.
      await client.context.setOffline(true);
      await portal.goto(url).catch(() => undefined);
      await expect(portal.getByText('Barbell Bench Press')).toHaveCount(0);
    } finally {
      await client.context.close();
    }
  });

  test('a workout kept from the portal home opens and starts offline; the start syncs with its sets (PRD D4)', async ({
    page,
    browser,
  }) => {
    const client = await coachAndClient(page, browser, 'Una Upcoming');
    try {
      await buildProgram(page, 'Upcoming block', [[EXERCISES[0]]]);
      await assignFromClientTab(page, 'Una Upcoming', 'Upcoming block');
      const portal = client.page;
      await portal.goto('/portal');
      const link = portal.getByRole('link', { name: /Start workout/ });
      const href = (await link.getAttribute('href')) as string;
      const sessionId = href.split('/').pop() as string;
      // Online, the portal home asks the worker to keep the next 7 days of workouts.
      await portal.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
        timeout: 30_000,
      });
      await portal.reload();
      await expect
        .poll(
          () =>
            portal.evaluate(async (path) => {
              for (const name of await caches.keys()) {
                if (await (await caches.open(name)).match(path)) return true;
              }
              return false;
            }, href),
          { timeout: 30_000 },
        )
        .toBe(true);

      await client.context.setOffline(true);
      await portal.goto(href);
      await expect(portal.getByText("You're offline. You can still start")).toBeVisible({
        timeout: 30_000,
      });
      await portal.getByRole('button', { name: 'Start workout' }).click();
      await fillAndBlur(portal, 'Barbell Bench Press', {
        'Set 1 reps': '5',
        'Set 1 weight (kg)': '70',
      });
      await expect(status(portal, 'Saved on device')).toBeVisible({ timeout: 15_000 });
      expect((await sessionFacts(sessionId)).state).toBe('scheduled');

      // A closed page reopens offline still started, with the set.
      await portal.close();
      const reopened = await client.context.newPage();
      await reopened.goto(href);
      const row = reopened.getByRole('region', { name: 'Barbell Bench Press' });
      await expect(row.getByLabel('Set 1 reps', { exact: true })).toHaveValue('5', {
        timeout: 30_000,
      });
      await expect(row.getByLabel('Set 1 weight (kg)', { exact: true })).toHaveValue('70');

      await client.context.setOffline(false);
      await expect(status(reopened, 'Synced')).toBeVisible({ timeout: 45_000 });
      expect(await sessionFacts(sessionId)).toMatchObject({
        state: 'in_progress',
        rows: 1,
        onLocked: 1,
      });
    } finally {
      await client.context.close();
    }
  });

  test('a row typed but not saved survives a crash and reopens as typed (PRD D20)', async ({
    page,
    browser,
  }) => {
    const client = await coachAndClient(page, browser, 'Cora Crash');
    try {
      await buildProgram(page, 'Crash block', [[EXERCISES[0]]]);
      await assignFromClientTab(page, 'Cora Crash', 'Crash block');
      const portal = client.page;
      const sessionId = await startToday(portal);
      const url = portal.url();
      const card = portal.getByRole('region', { name: 'Barbell Bench Press' });
      await card.getByLabel('Set 1 reps', { exact: true }).fill('7');
      // No blur, no save: the page is killed mid-entry.
      await expect
        .poll(
          () =>
            portal.evaluate(
              (id) =>
                new Promise<number>((resolve) => {
                  const req = indexedDB.open('repsy-offline');
                  req.onsuccess = () => {
                    const tx = req.result.transaction('drafts', 'readonly');
                    const n = tx.objectStore('drafts').index('sessionId').count(id);
                    n.onsuccess = () => resolve(n.result);
                  };
                }),
              sessionId,
            ),
          { timeout: 15_000 },
        )
        .toBe(1);
      await portal.close({ runBeforeUnload: false });
      await client.context.setOffline(true);
      const reopened = await client.context.newPage();
      await reopened.goto(url);
      await expect(
        reopened
          .getByRole('region', { name: 'Barbell Bench Press' })
          .getByLabel('Set 1 reps', { exact: true }),
      ).toHaveValue('7', { timeout: 30_000 });
    } finally {
      await client.context.close();
    }
  });
});
