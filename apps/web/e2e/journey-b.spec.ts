/**
 * Journey B (S3-1): a coach edits a client's own program safely. Autosaved drafts survive a reload, "Save changes"
 * confirms with the D-001 copy and commits a version, a second tab saving first turns the first tab's save into a
 * conflict that keeps its edit, and the version history lists every save.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const D001 =
  'This update will apply only to upcoming workouts. Completed and already-started workouts will remain unchanged.';
const CLIENT = 'Bea Builder';

const bench = (page: Page) =>
  page
    .getByRole('group', { name: 'Day 1', exact: true })
    .getByRole('group', { name: 'Barbell Bench Press' });
const reps = (page: Page) => bench(page).getByRole('group', { name: 'Set 1' }).getByLabel('Reps');
const dayTitle = (page: Page) =>
  page.getByRole('group', { name: 'Day 1', exact: true }).getByLabel('Day title');
const draftSaved = (page: Page) => page.getByRole('status').filter({ hasText: 'Draft saved' });

/** "Save changes" on a client copy, confirmed in the D-001 dialog. */
async function saveClientProgram(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Save changes to ${CLIENT}'s program?` });
  await expect(dialog.getByText(D001, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

test.describe('Journey B: editing a client program', () => {
  // Full journey (sign-up, invite, build, assign, edits in two contexts) on a cold dev server.
  test.describe.configure({ timeout: 240_000 });

  test('autosave, reload restore, D-001 save, two-tab conflict, reload latest, history', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, CLIENT);
    await client.context.close();
    await buildProgram(page, 'Journey B block', [[['bench', 'Barbell Bench Press']]]);
    await assignFromClientTab(page, CLIENT, 'Journey B block', 1);

    // Open the client's own program from the client page.
    await expect(page.getByRole('link', { name: 'Version history' })).toBeVisible();
    await page.getByRole('link', { name: 'Edit program' }).click();
    await expect(page).toHaveURL(/\/app\/programs\/[0-9a-f-]{36}\/edit$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: `Edit ${CLIENT}'s program` })).toBeVisible();
    await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
    await expect(page.getByText('1 day per week')).toBeVisible();
    await expect(page.getByRole('button', { name: 'More days' })).toHaveCount(0);
    const rail = page.getByRole('complementary', { name: `${CLIENT}'s last performance` });
    await expect(rail.getByText('No logged sets yet.')).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);
    const editorUrl = page.url();

    // An edit undone back to the saved content leaves no draft behind: nothing is restored on reload.
    await reps(page).fill('9');
    await expect(draftSaved(page)).toBeVisible({ timeout: 30_000 });
    const discarded = page.waitForResponse(
      (r) => r.url().endsWith('/draft') && r.request().method() === 'DELETE',
    );
    await reps(page).fill('10');
    expect((await discarded).status()).toBe(204);
    await page.reload();
    await expect(reps(page)).toHaveValue('10');
    await expect(page.getByText('Version 1', { exact: true })).toBeVisible();
    await expect(page.getByText('Restored your unsaved draft.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();

    // Edit a target: the draft autosaves, and a reload mid-edit restores it.
    await reps(page).fill('6');
    await expect(draftSaved(page)).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByText('Restored your unsaved draft.')).toBeVisible();
    await expect(reps(page)).toHaveValue('6');
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByText('Restored your unsaved draft.')).toHaveCount(0);

    // "Save changes" shows the D-001 copy (axe with the dialog open), then commits version 2.
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: `Save changes to ${CLIENT}'s program?` });
    await expect(confirm.getByText(D001, { exact: true })).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Keep editing' })).toBeVisible();
    await expectNoAxeViolations(page);
    await confirm.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved as version 2')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible();

    // A second browser context (same coach) opens version 2 too.
    const other = await browser.newContext({ storageState: await page.context().storageState() });
    const second = await other.newPage();
    await second.goto(editorUrl);
    await expect(reps(second)).toHaveValue('6', { timeout: 30_000 });
    await expect(second.getByText('Version 2', { exact: true })).toBeVisible();

    // The first tab edits; the second tab saves version 3 from the same base first.
    await reps(page).fill('7');
    await expect(draftSaved(page)).toBeVisible({ timeout: 30_000 });
    await dayTitle(second).fill('Second tab day');
    await expect(draftSaved(second)).toBeVisible({ timeout: 30_000 });
    await saveClientProgram(second);
    await expect(second.getByText('Saved as version 3')).toBeVisible({ timeout: 30_000 });
    await other.close();

    // The first tab's save conflicts: nothing is overwritten and its edit stays in the form.
    await saveClientProgram(page);
    await expect(
      page.getByText('A newer version (version 3) was saved. Your draft is kept.'),
    ).toBeVisible();
    await expect(reps(page)).toHaveValue('7');
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    // "Reload latest" discards the draft after a confirmation and shows version 3.
    await page.getByRole('button', { name: 'Reload latest' }).click();
    const reload = page.getByRole('dialog', { name: 'Reload the latest version?' });
    await expect(reload.getByText('Reloading discards your draft.')).toBeVisible();
    await reload.getByRole('button', { name: 'Reload latest' }).click();
    await expect(page.getByText('Version 3', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(dayTitle(page)).toHaveValue('Second tab day');
    await expect(reps(page)).toHaveValue('6');
    await expect(page.getByText('Restored your unsaved draft.')).toHaveCount(0);

    // History lists all three versions, newest first; each opens read-only.
    await page.getByRole('link', { name: 'Version history' }).click();
    // The first visit compiles the route on a cold dev server.
    await expect(page.getByRole('heading', { name: 'Version history', level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    const rows = page.getByRole('row');
    await expect(rows).toHaveCount(4); // header + 3 versions
    await expect(rows.nth(1)).toContainText('Version 3');
    await expect(rows.nth(1)).toContainText('Casey Coach');
    await expect(rows.nth(3)).toContainText('Version 1');
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);

    await page.getByRole('link', { name: 'Version 1', exact: true }).click();
    await expect(page).toHaveURL(/\/versions\/1$/, { timeout: 30_000 });
    await expect(page.getByText('Set 1: 10 reps')).toBeVisible({ timeout: 30_000 });
    // Read-only: no form controls in the page content (the app shell has its own).
    // (Hidden controls of a previously visited route may stay mounted, so count visible ones.)
    await expect(
      page.getByRole('main').locator('input, textarea, select, button').filter({ visible: true }),
    ).toHaveCount(0);
    await expectNoAxeViolations(page);
    await page.getByRole('link', { name: 'Back to editor' }).click();
    await expect(page).toHaveURL(/\/edit$/, { timeout: 30_000 });

    // The client page links to the same history.
    await openClientTab(page, CLIENT, 'Program');
    await page.getByRole('link', { name: 'Version history' }).click();
    await expect(page.getByRole('row')).toHaveCount(4);

    // The editor with the performance rail fits a phone screen.
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(editorUrl);
    await expect(page.getByText('No logged sets yet.')).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(page);
    await expectNoAxeViolations(page);

    // Whole weeks can be added to a client copy; its days per week cannot change (Ruling 2).
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole('button', { name: 'Fewer days' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Duplicate week 1' })).toBeEnabled();

    // The template the copy came from counts this client.
    await page.goto('/app/programs');
    const row = page.getByRole('listitem').filter({ hasText: 'Journey B block' });
    await expect(row.getByText('Used by 1 client')).toBeVisible({ timeout: 30_000 });
  });
});
