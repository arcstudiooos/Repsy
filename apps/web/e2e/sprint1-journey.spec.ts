import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import {
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const D001 =
  'This update will apply only to upcoming workouts. Completed and already-started workouts will remain unchanged.';
const READINESS = "I've confirmed this client is ready to start this program.";

/** Coach adds and invites a client; the client accepts in a second context, which is closed again. */
async function onboard(coach: Page, request: APIRequestContext, browser: Browser, name: string) {
  const client = await onboardClient(coach, request, browser, name);
  await client.context.close();
}

const TWO_DAYS: (readonly [string, string])[][] = [
  [['bench', 'Barbell Bench Press']],
  [['romanian', 'Romanian Deadlift']],
];

const openProgramTab = (page: Page, clientName: string) =>
  openClientTab(page, clientName, 'Program');

test.describe('Sprint 1 journey', () => {
  // Full journeys (sign-up, invite, build, assign) on a cold dev server.
  test.describe.configure({ timeout: 180_000 });

  test('coach onboards and assigns', async ({ page, request, browser }) => {
    await signUpVerifiedCoach(page, request);
    await onboard(page, request, browser, 'Jo Journey');
    await buildProgram(page, 'Journey block', TWO_DAYS);
    await openProgramTab(page, 'Jo Journey');
    await expect(page.getByText('No program yet')).toBeVisible();

    await page.getByRole('button', { name: 'Assign a program' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assign a program' });
    await expect(dialog.getByLabel('Start date')).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
    await dialog.getByLabel('Program', { exact: true }).selectOption({ label: 'Journey block' });
    await dialog.getByLabel('Monday').check();
    await expect(dialog.getByText('Choose 2 training days.')).toBeVisible();
    await dialog.getByLabel('Thursday').check();
    await expect(dialog.getByText('Choose 2 training days.')).toHaveCount(0);
    await expect(dialog.getByText(READINESS)).toBeVisible();
    await expectNoAxeViolations(page);

    // Readiness is required for a first assignment.
    await dialog.getByRole('button', { name: 'Assign program', exact: true }).click();
    await expect(
      dialog.getByText('Confirm this client is ready to start this program.'),
    ).toBeVisible();
    await dialog.getByLabel(READINESS).check();
    await dialog.getByRole('button', { name: 'Assign program', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // The assignment summary (the phase picker lists the template too, C17).
    await expect(page.getByRole('definition').filter({ hasText: 'Journey block' })).toBeVisible();
    await expect(page.getByText('2 sessions')).toBeVisible();
    await expect(page.getByText('Mon, Thu')).toBeVisible();
    await expect(page.getByText('Next session')).toBeVisible();
    await expectNoAxeViolations(page);

    // Reopening after success starts fresh at the details step, not the stale confirm step.
    await page.getByRole('button', { name: 'Change program' }).click();
    const reopened = page.getByRole('dialog', { name: 'Assign a program' });
    await expect(reopened.getByRole('button', { name: 'Continue' })).toBeVisible();
    await expect(reopened.getByText(D001)).toHaveCount(0);
    await expect(reopened.getByLabel('Monday')).not.toBeChecked();
    await expect(reopened.getByLabel('Program', { exact: true })).toHaveValue('');
  });

  test('replacing shows the D-001 confirmation copy', async ({ page, request, browser }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signUpVerifiedCoach(page, request);
    await onboard(page, request, browser, 'Rae Replace');
    await buildProgram(page, 'Replace me', TWO_DAYS);
    await openProgramTab(page, 'Rae Replace');

    await page.getByRole('button', { name: 'Assign a program' }).click();
    let dialog = page.getByRole('dialog', { name: 'Assign a program' });
    await dialog.getByLabel('Program', { exact: true }).selectOption({ label: 'Replace me' });
    await dialog.getByLabel('Tuesday').check();
    await dialog.getByLabel('Friday').check();
    await dialog.getByLabel(READINESS).check();
    await dialog.getByRole('button', { name: 'Assign program', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText('2 sessions')).toBeVisible();

    await page.getByRole('button', { name: 'Change program' }).click();
    dialog = page.getByRole('dialog', { name: 'Assign a program' });
    await expect(dialog.getByText(READINESS)).toHaveCount(0);
    await dialog.getByLabel('Program', { exact: true }).selectOption({ label: 'Replace me' });
    await dialog.getByLabel('Monday').check();
    await dialog.getByLabel('Thursday').check();
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog.getByText(D001)).toBeVisible();
    await expectNoAxeViolations(page);
    await expectNoHorizontalOverflow(page);
    await dialog.getByRole('button', { name: 'Replace program' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText('Mon, Thu')).toBeVisible();
    await expect(page.getByText('2 sessions')).toBeVisible();

    // The dialog stays mounted across the refresh: it must not reopen on the stale confirm step.
    await page.getByRole('button', { name: 'Change program' }).click();
    const reopened = page.getByRole('dialog', { name: 'Assign a program' });
    await expect(reopened.getByRole('button', { name: 'Continue' })).toBeVisible();
    await expect(reopened.getByText(D001)).toHaveCount(0);
    await expect(reopened.getByRole('button', { name: 'Replace program' })).toHaveCount(0);
    await expect(reopened.getByLabel('Monday')).not.toBeChecked();
  });

  test('assign from the Programs list', async ({ page, request, browser }) => {
    await signUpVerifiedCoach(page, request);
    await onboard(page, request, browser, 'Lee List');
    await buildProgram(page, 'From the list', TWO_DAYS);
    await page.goto('/app/programs');
    await page.getByRole('button', { name: 'Assign From the list' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assign a program' });
    await dialog.getByLabel('Client', { exact: true }).selectOption({ label: 'Lee List' });
    await dialog.getByLabel('Tuesday').check();
    await dialog.getByLabel('Saturday').check();
    await dialog.getByLabel(READINESS).check();
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Assign program', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await openProgramTab(page, 'Lee List');
    await expect(page.getByRole('definition').filter({ hasText: 'From the list' })).toBeVisible();
    await expect(page.getByText('Tue, Sat')).toBeVisible();
  });

  test('the server-side 422 readiness error reaches the dialog', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    await onboard(page, request, browser, 'Ree Ready');
    await buildProgram(page, 'Readiness check', TWO_DAYS);
    await openProgramTab(page, 'Ree Ready');
    // The UI requires the box; strip it from the request so only the server rule applies.
    await page.route('**/api/v1/programs/*/assign', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      await route.continue({ postData: JSON.stringify({ ...body, readinessConfirmed: false }) });
    });
    await page.getByRole('button', { name: 'Assign a program' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assign a program' });
    await dialog.getByLabel('Program', { exact: true }).selectOption({ label: 'Readiness check' });
    await dialog.getByLabel('Monday').check();
    await dialog.getByLabel('Wednesday').check();
    await dialog.getByLabel(READINESS).check();
    await dialog.getByRole('button', { name: 'Assign program', exact: true }).click();
    await expect(
      dialog.getByText('Confirm this client is ready to start this program.'),
    ).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toBeVisible();
    await page.unroute('**/api/v1/programs/*/assign');
  });

  test('a 409 from the details step moves to the replacement confirmation', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    await onboard(page, request, browser, 'Con Flict');
    await buildProgram(page, 'First come', TWO_DAYS);
    await openProgramTab(page, 'Con Flict');
    // This tab still believes there is no active program.
    await page.getByRole('button', { name: 'Assign a program' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assign a program' });
    await dialog.getByLabel('Program', { exact: true }).selectOption({ label: 'First come' });
    await dialog.getByLabel('Monday').check();
    await dialog.getByLabel('Thursday').check();
    await dialog.getByLabel(READINESS).check();

    // Meanwhile a second tab assigns first.
    const other = await page.context().newPage();
    await openProgramTab(other, 'Con Flict');
    await other.getByRole('button', { name: 'Assign a program' }).click();
    const otherDialog = other.getByRole('dialog', { name: 'Assign a program' });
    await otherDialog.getByLabel('Program', { exact: true }).selectOption({ label: 'First come' });
    await otherDialog.getByLabel('Tuesday').check();
    await otherDialog.getByLabel('Friday').check();
    await otherDialog.getByLabel(READINESS).check();
    await otherDialog.getByRole('button', { name: 'Assign program', exact: true }).click();
    await expect(otherDialog).toBeHidden({ timeout: 30_000 });
    await other.close();

    await dialog.getByRole('button', { name: 'Assign program', exact: true }).click();
    await expect(dialog.getByText(D001)).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Replace program' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText('Mon, Thu')).toBeVisible();
  });
});
