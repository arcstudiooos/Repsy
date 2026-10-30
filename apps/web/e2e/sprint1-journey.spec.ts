import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { E2E_PASSWORD, signUpVerifiedCoach, waitForEmail } from './helpers/users';

const D001 =
  'This update will apply only to upcoming workouts. Completed and already-started workouts will remain unchanged.';
const READINESS = "I've confirmed this client is ready to start this program.";

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}

/** Coach adds a client in the UI and sends the invite; the client accepts in a second context. */
async function onboardClient(
  coach: Page,
  request: APIRequestContext,
  browser: Browser,
  name: string,
): Promise<void> {
  const email = `journey-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
  await coach.goto('/app/clients');
  await coach.getByRole('button', { name: 'Add client' }).click();
  const dialog = coach.getByRole('dialog', { name: 'Add client' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Email', { exact: true }).fill(email);
  await expect(dialog.getByLabel('Send invite email now')).toBeChecked();
  await dialog.getByRole('button', { name: 'Add client' }).click();
  await expect(dialog).toBeHidden();

  const mail = await waitForEmail(request, email, 'client_invite');
  const link = /https?:\/\/\S+\/invite\/\S+/.exec(mail.text)?.[0] as string;
  expect(link).toBeTruthy();

  const context = await browser.newContext();
  const invitee = await context.newPage();
  try {
    await invitee.goto(link);
    await invitee.getByLabel('Choose a password').fill(E2E_PASSWORD);
    await invitee.getByLabel('I agree to share my training data with').check();
    await invitee.getByRole('button', { name: 'Accept invite' }).click();
    await expect(invitee).toHaveURL(/\/portal$/, { timeout: 30_000 });
  } finally {
    await context.close();
  }
}

/** Builds and saves a 1-week x 2-day template. */
async function buildProgram(page: Page, title: string): Promise<void> {
  await page.goto('/app/programs');
  await page.getByRole('button', { name: 'New program' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New program' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Create program' }).click();
  await expect(page).toHaveURL(/\/app\/programs\/[0-9a-f-]{36}\/edit$/, { timeout: 30_000 });
  await expect(page.getByLabel('Program title')).toHaveValue(title);
  await page.getByRole('button', { name: 'More days' }).click();
  await expect(page.getByText('2 days per week')).toBeVisible();
  for (const [day, search, name] of [
    ['Day 1', 'bench', 'Barbell Bench Press'],
    ['Day 2', 'romanian', 'Romanian Deadlift'],
  ] as const) {
    const group = page.getByRole('group', { name: day, exact: true });
    await group.getByRole('button', { name: 'Add exercise' }).click();
    const picker = page.getByRole('dialog', { name: 'Add exercise' });
    await picker.getByLabel('Search exercises').fill(search);
    await picker.getByRole('button', { name: `Add ${name}` }).click();
    await expect(picker).toBeHidden();
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved as version 1')).toBeVisible({ timeout: 30_000 });
}

async function openProgramTab(page: Page, clientName: string): Promise<void> {
  await page.goto('/app/clients');
  await page.getByRole('link', { name: clientName }).first().click();
  await page.getByRole('link', { name: 'Program', exact: true }).click();
  await expect(page).toHaveURL(/\/program$/);
}

test.describe('Sprint 1 journey', () => {
  test('coach onboards and assigns', async ({ page, request, browser }) => {
    await signUpVerifiedCoach(page, request);
    await onboardClient(page, request, browser, 'Jo Journey');
    await buildProgram(page, 'Journey block');
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

    await expect(page.getByText('Journey block')).toBeVisible();
    await expect(page.getByText('2 sessions')).toBeVisible();
    await expect(page.getByText('Mon, Thu')).toBeVisible();
    await expect(page.getByText('Next session')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('replacing shows the D-001 confirmation copy', async ({ page, request, browser }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await signUpVerifiedCoach(page, request);
    await onboardClient(page, request, browser, 'Rae Replace');
    await buildProgram(page, 'Replace me');
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
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await dialog.getByRole('button', { name: 'Replace program' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText('Mon, Thu')).toBeVisible();
    await expect(page.getByText('2 sessions')).toBeVisible();
  });
});
