/**
 * Journey helpers shared by the Sprint 1 journey, portal, logging, review and golden-path specs. They drive the
 * real UI: the coach adds and invites a client, the client accepts in a second browser context, the coach builds
 * and assigns a program.
 */
import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { E2E_PASSWORD, waitForEmail } from './users';

export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

export interface OnboardedClient {
  name: string;
  email: string;
  /** The client's own browser context, signed in on the portal. Close it when done. */
  context: BrowserContext;
  page: Page;
}

/** Coach adds a client in the UI and sends the invite; the client accepts in a second context and stays signed in. */
export async function onboardClient(
  coach: Page,
  request: APIRequestContext,
  browser: Browser,
  name: string,
  opts: { units?: 'kg' | 'lb' } = {},
): Promise<OnboardedClient> {
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
  const page = await context.newPage();
  await page.goto(link);
  await page.getByLabel('Choose a password').fill(E2E_PASSWORD);
  if (opts.units === 'lb') await page.getByLabel('Units').selectOption('lb');
  await page.getByLabel('I agree to share my training data with').check();
  await page.getByRole('button', { name: 'Accept invite' }).click();
  await expect(page).toHaveURL(/\/portal$/, { timeout: 30_000 });
  return { name, email, context, page };
}

/** Builds and saves a 1-week template with one exercise per entry of `days` (each entry: [search, exercise name][]). */
export async function buildProgram(
  page: Page,
  title: string,
  days: (readonly [search: string, name: string])[][],
): Promise<void> {
  await page.goto('/app/programs');
  await page.getByRole('button', { name: 'New program' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New program' });
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('button', { name: 'Create program' }).click();
  await expect(page).toHaveURL(/\/app\/programs\/[0-9a-f-]{36}\/edit$/, { timeout: 30_000 });
  await expect(page.getByLabel('Program title')).toHaveValue(title);
  for (let d = 1; d < days.length; d++) {
    await page.getByRole('button', { name: 'More days' }).click();
  }
  await expect(
    page.getByText(`${days.length} ${days.length === 1 ? 'day' : 'days'} per week`),
  ).toBeVisible();
  for (const [i, exercises] of days.entries()) {
    const group = page.getByRole('group', { name: `Day ${i + 1}`, exact: true });
    for (const [search, name] of exercises) {
      await group.getByRole('button', { name: 'Add exercise' }).click();
      const picker = page.getByRole('dialog', { name: 'Add exercise' });
      await picker.getByLabel('Search exercises').fill(search);
      await picker.getByRole('button', { name: `Add ${name}` }).click();
      await expect(picker).toBeHidden();
    }
  }
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved as version 1')).toBeVisible({ timeout: 30_000 });
}

export async function openClientTab(page: Page, clientName: string, tab: string): Promise<void> {
  await page.goto('/app/clients');
  await page.getByRole('link', { name: clientName }).first().click();
  await page.getByRole('link', { name: tab, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${tab.toLowerCase()}$`));
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Today's weekday name in `timeZone` (the client accepted with the browser's zone, which is the runner's). */
export function todayWeekday(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone }).format(new Date());
}

/**
 * Assigns `programTitle` from the client's Program tab, starting today (the dialog default) on today's weekday plus
 * the following weekdays as needed for `daysPerWeek`. Readiness is confirmed (first assignment).
 */
export async function assignFromClientTab(
  page: Page,
  clientName: string,
  programTitle: string,
  daysPerWeek = 1,
): Promise<void> {
  await openClientTab(page, clientName, 'Program');
  await page.getByRole('button', { name: 'Assign a program' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign a program' });
  await dialog.getByLabel('Program', { exact: true }).selectOption({ label: programTitle });
  const start = WEEKDAYS.indexOf(todayWeekday());
  for (let i = 0; i < daysPerWeek; i++) {
    await dialog.getByLabel(WEEKDAYS[(start + i) % 7] as string).check();
  }
  await dialog.getByLabel("I've confirmed this client is ready to start this program.").check();
  await dialog.getByRole('button', { name: 'Assign program', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}
