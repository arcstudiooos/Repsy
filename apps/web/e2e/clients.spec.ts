import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { signUpVerifiedCoach } from './helpers/users';

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`),
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Creates a client through the API (same-origin, so the CSRF Origin check passes). */
async function apiCreateClient(
  request: APIRequestContext,
  baseURL: string,
  body: { name: string; email: string },
) {
  const res = await request.post('/api/v1/clients', {
    data: body,
    headers: { origin: new URL(baseURL).origin },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { data: { id: string } }).data;
}

async function addClientViaDialog(page: Page, name: string, email: string) {
  await page.getByRole('button', { name: 'Add client' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add client' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Email', { exact: true }).fill(email);
  await dialog.getByRole('button', { name: 'Add client' }).click();
  return dialog;
}

test.describe('client directory', () => {
  test('empty roster shows one next action', async ({ page, request }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/app/clients');
    await expect(page.getByRole('heading', { name: 'Clients', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add your first client' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add client' })).toHaveCount(1);
  });

  test('coach adds a client and sees it in the roster', async ({ page, request }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/app/clients');
    const email = `ada-${Date.now()}@example.test`;
    const dialog = await addClientViaDialog(page, 'Ada Lovelace', email);
    // Create + invite + first-hit route compile in dev can take a few seconds.
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    const row = page.getByRole('row', { name: /Ada Lovelace/ });
    await expect(row).toBeVisible();
    await expect(row.getByText('Invited')).toBeVisible();
    await expect(row.getByText(email)).toBeVisible();
  });

  test('dialog shows inline field errors', async ({ page, request }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/app/clients');
    const email = `dup-${Date.now()}@example.test`;
    await expect(await addClientViaDialog(page, 'First Dup', email)).toBeHidden({
      timeout: 15_000,
    });
    await expect(page.getByRole('row', { name: /First Dup/ })).toBeVisible();
    const dialog = await addClientViaDialog(page, 'Second Dup', email);
    await expect(dialog.getByText('A client with this email already exists.')).toBeVisible();
    await expect(dialog.getByLabel('Email', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  test('search filters the roster', async ({ page, request, baseURL }) => {
    await signUpVerifiedCoach(page, request);
    const stamp = Date.now();
    await apiCreateClient(page.request, baseURL as string, {
      name: 'Zebra Zed',
      email: `zed-${stamp}@example.test`,
    });
    await apiCreateClient(page.request, baseURL as string, {
      name: 'Quinn Quokka',
      email: `quinn-${stamp}@example.test`,
    });
    await page.goto('/app/clients');
    await expect(page.getByRole('row', { name: /Zebra Zed/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /Quinn Quokka/ })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search clients' }).fill('quokka');
    await expect(page).toHaveURL(/q=quokka/);
    await expect(page.getByRole('row', { name: /Zebra Zed/ })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /Quinn Quokka/ })).toBeVisible();
  });

  test('search input stays in sync with the URL', async ({ page, request, baseURL }) => {
    await signUpVerifiedCoach(page, request);
    await apiCreateClient(page.request, baseURL as string, {
      name: 'Sync Sam',
      email: `sam-${Date.now()}@example.test`,
    });
    await page.goto('/app/clients');
    const box = page.getByRole('searchbox', { name: 'Search clients' });
    const row = page.getByRole('row', { name: /Sync Sam/ });
    await expect(row).toBeVisible();

    await box.fill('nomatchzzz');
    await expect(page).toHaveURL(/q=nomatchzzz/);
    await expect(page.getByRole('heading', { name: 'No clients match' })).toBeVisible();

    await page.getByRole('link', { name: 'Clear filters' }).click();
    await expect(box).toHaveValue('');
    await expect(row).toBeVisible();

    // Back restores the previous query text; forward clears it again.
    await page.goBack();
    await expect(page).toHaveURL(/q=nomatchzzz/);
    await expect(box).toHaveValue('nomatchzzz');
    await page.goForward();
    await expect(box).toHaveValue('');
    await expect(row).toBeVisible();

    // Same term again must filter again (debounce baseline was resynced).
    await box.fill('nomatchzzz');
    await expect(page).toHaveURL(/q=nomatchzzz/);
    await expect(page.getByRole('heading', { name: 'No clients match' })).toBeVisible();
  });

  test('limit message shows at 30', async ({ page, request, baseURL }) => {
    test.setTimeout(120_000);
    await signUpVerifiedCoach(page, request);
    const stamp = Date.now();
    for (let i = 0; i < 30; i++) {
      await apiCreateClient(page.request, baseURL as string, {
        name: `Seed ${i}`,
        email: `seed-${stamp}-${i}@example.test`,
      });
    }
    await page.goto('/app/clients');
    const dialog = await addClientViaDialog(page, 'One Too Many', `extra-${stamp}@example.test`);
    await expect(dialog.getByText('Pilot access includes up to 30 active clients.')).toBeVisible();
  });

  for (const vp of VIEWPORTS) {
    test(`client page tabs are keyboard reachable and axe-clean at ${vp.width}`, async ({
      page,
      request,
      baseURL,
    }) => {
      await page.setViewportSize(vp);
      await signUpVerifiedCoach(page, request);
      const created = await apiCreateClient(page.request, baseURL as string, {
        name: 'Tab Tester',
        email: `tab-${Date.now()}@example.test`,
      });

      await page.goto('/app/clients');
      await expect(page.getByRole('link', { name: 'Tab Tester' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);

      await page.goto(`/app/clients/${created.id}`);
      await expect(page.getByRole('heading', { name: 'Tab Tester', level: 1 })).toBeVisible();
      const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
      await expect(crumbs).toContainText('Clients');
      await expect(crumbs).toContainText('Tab Tester');

      const tabs = page.getByRole('navigation', { name: 'Client sections' });
      await expect(tabs.getByRole('link')).toHaveText([
        'Overview',
        'Program',
        'Sessions',
        'Check-ins',
        'Messages',
        'Notes',
        'History',
      ]);
      await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);

      // Keyboard: tab onto the Program link and activate it.
      await tabs.getByRole('link', { name: 'Overview' }).focus();
      await page.keyboard.press('Tab');
      await expect(tabs.getByRole('link', { name: 'Program' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/program$/, { timeout: 15_000 });
      await expect(page.getByRole('heading', { name: 'No program yet' })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }

  test('roster and overview show rolling adherence (PRD I5)', async ({
    page,
    request,
    baseURL,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await apiCreateClient(page.request, baseURL as string, {
      name: 'Grace Hopper',
      email: `grace-${Date.now()}@example.test`,
    });
    await page.goto('/app/clients');
    for (const name of ['7d', '30d', '90d']) {
      await expect(page.getByRole('columnheader', { name })).toBeVisible();
    }
    // Nothing is due yet: every window reads "No sessions due yet", never 0%.
    const row = page.getByRole('row', { name: /Grace Hopper/ });
    await expect(row.getByText('No sessions due yet')).toHaveCount(3);
    await expectNoAxeViolations(page);

    await page.goto(`/app/clients/${client.id}`);
    const card = page.getByRole('heading', { name: 'Adherence', level: 2 });
    await expect(card).toBeVisible();
    await expect(page.getByText('Last 90 days')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('unknown client id is a 404 page', async ({ page, request }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/app/clients/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('This page could not be found.')).toBeVisible();
  });
});
