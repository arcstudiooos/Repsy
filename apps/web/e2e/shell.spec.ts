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

test.describe('app shells', () => {
  // One worker creates the users once for the whole group.
  test.describe.configure({ mode: 'serial' });
  let coachState: StorageState;
  let clientState: StorageState;

  test.beforeAll(async ({ browser }) => {
    const coachCtx = await browser.newContext();
    const coach: E2EUser = await signUpVerifiedCoach(await coachCtx.newPage(), coachCtx.request);
    coachState = await coachCtx.storageState();
    await coachCtx.close();

    const clientCtx = await browser.newContext();
    await signUpVerifiedClient(await clientCtx.newPage(), clientCtx.request, coach);
    clientState = await clientCtx.storageState();
    await clientCtx.close();
  });

  for (const vp of VIEWPORTS) {
    test(`coach shell has no axe violations at ${vp.width}`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: coachState, viewport: vp });
      const page = await ctx.newPage();
      await page.goto('/app');
      await expect(page.getByRole('heading', { name: 'Coach dashboard' })).toBeVisible();
      const mobile = vp.width < 768;
      const nav = page.getByRole('navigation', {
        name: mobile ? 'Primary mobile' : 'Primary',
        exact: true,
      });
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link')).toHaveText(
        mobile
          ? ['Home', 'Clients', 'Review', 'Messages', 'More']
          : ['Overview', 'Clients', 'Programs', 'Review', 'Messages', 'Analytics', 'Settings'],
      );
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await ctx.close();
    });

    test(`portal shell has no axe violations at ${vp.width}`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: clientState, viewport: vp });
      const page = await ctx.newPage();
      await page.goto('/portal');
      await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
      const nav = page.getByRole('navigation', { name: 'Portal' });
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link')).toHaveText([
        'Home',
        'Workouts',
        'Check-ins',
        'Messages',
        'Profile',
      ]);
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await ctx.close();
    });
  }
});
