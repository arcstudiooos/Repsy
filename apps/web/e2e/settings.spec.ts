import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signUpVerifiedClient, signUpVerifiedCoach, type E2EUser } from './helpers/users';

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;

type StorageState = Awaited<ReturnType<ReturnType<Page['context']>['storageState']>>;

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

test('/settings without a session redirects to /login', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login/);
});

test('/portal/profile without a session redirects to /login', async ({ page }) => {
  await page.goto('/portal/profile');
  await expect(page).toHaveURL(/\/login/);
});

test('pilot access card shows 1 of 30 after one client', async ({ page, request, baseURL }) => {
  await signUpVerifiedCoach(page, request);
  const created = await page.request.post('/api/v1/clients', {
    data: { name: 'Pat Pilot', email: `pat-${Date.now()}@example.test` },
    headers: { origin: new URL(baseURL as string).origin },
  });
  expect(created.status()).toBe(201);
  await page.goto('/settings');
  await expect(
    page.getByRole('heading', { name: 'Pilot access · 1 of 30 active clients' }),
  ).toBeVisible();
});

test.describe('settings', () => {
  // One worker creates the users once for the whole group.
  test.describe.configure({ mode: 'serial' });
  let coachState: StorageState;
  let clientState: StorageState;

  test.beforeAll(async ({ browser }) => {
    const coachCtx = await browser.newContext();
    const coachPage = await coachCtx.newPage();
    const coach: E2EUser = await signUpVerifiedCoach(coachPage, coachCtx.request);
    coachState = await coachCtx.storageState();
    await coachCtx.close();

    const clientCtx = await browser.newContext();
    await signUpVerifiedClient(await clientCtx.newPage(), clientCtx.request, coach);
    clientState = await clientCtx.storageState();
    await clientCtx.close();
  });

  test('settings page sections and always-sent copy', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: coachState });
    const page = await ctx.newPage();
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out of all other devices' })).toBeVisible();
    await expect(
      page.getByText('Account emails like verification and password reset are always sent.'),
    ).toBeVisible();
    await ctx.close();
  });

  test('owner saves the grace period and sees validation errors', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: coachState });
    const page = await ctx.newPage();
    await page.goto('/settings');
    const grace = page.getByLabel('Grace period (hours)');
    const form = page.locator('form').filter({ has: grace });
    await grace.fill('73');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Use a whole number from 0 to 72.')).toBeVisible();
    await grace.fill('36');
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Training defaults saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Grace period (hours)')).toHaveValue('36');
    await ctx.close();
  });

  for (const vp of VIEWPORTS) {
    test(`coach settings has no axe violations at ${vp.width}`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: coachState, viewport: vp });
      const page = await ctx.newPage();
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await ctx.close();
    });

    test(`portal profile has no axe violations at ${vp.width}`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: clientState, viewport: vp });
      const page = await ctx.newPage();
      await page.goto('/portal/profile');
      await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible();
      // S5-2 / S5-3: export and deletion are live.
      await expect(page.getByRole('button', { name: 'Download my data' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Request deletion' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await ctx.close();
    });
  }

  test('client reaching /settings is routed to the portal; sign out works', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: clientState });
    const page = await ctx.newPage();
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/portal$/);
    await page.goto('/portal/profile');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });
});
