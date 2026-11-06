import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signUpVerifiedClient, signUpVerifiedCoach, type E2EUser } from './helpers/users';

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
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
    for (const theme of ['light', 'dark'] as const) {
      test(`coach shell has no axe violations at ${vp.width} (${theme})`, async ({ browser }) => {
        const ctx = await browser.newContext({ storageState: coachState, viewport: vp });
        await ctx.addInitScript((t) => window.localStorage.setItem('repsy-theme', t), theme);
        const page = await ctx.newPage();
        await page.goto('/app');
        await expect(page.getByRole('heading', { name: 'Coach dashboard' })).toBeVisible();
        const mobile = vp.width < 768;
        const nav = page.getByRole('navigation', {
          name: mobile ? 'Primary mobile' : 'Primary',
          exact: true,
        });
        await expect(nav).toBeVisible();
        // D-018 sidebar: the daily loop, then Business; Library is a closed group on the full rail and shows as
        // icons on the 72px rail (the default below 1024px). Settings and Help are pinned at the bottom.
        const library = [
          'Resources',
          'Courses',
          'Assessments',
          'Meal plans',
          'Groups',
          'Challenges',
        ];
        await expect(nav.getByRole('link')).toHaveText(
          mobile
            ? ['Home', 'Clients', 'Review', 'Messages', 'More']
            : [
                'Overview',
                'Clients',
                'Review',
                'Messages',
                'Programs',
                'Check-ins',
                'Analytics',
                'Scheduling',
                'Payments',
                'Leads',
                'AI assistant',
                'Automations',
                ...(vp.width < 1024 ? library : []),
                'Settings',
                'Help',
              ],
        );
        await expect(nav.getByRole('link', { name: mobile ? 'Home' : 'Overview' })).toHaveAttribute(
          'aria-current',
          'page',
        );
        await expect(nav.locator('[aria-current=page]')).toHaveCount(1);
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
        await ctx.close();
      });

      test(`portal shell has no axe violations at ${vp.width} (${theme})`, async ({ browser }) => {
        const ctx = await browser.newContext({ storageState: clientState, viewport: vp });
        await ctx.addInitScript((t) => window.localStorage.setItem('repsy-theme', t), theme);
        const page = await ctx.newPage();
        await page.goto('/portal');
        await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
        const nav = page.getByRole('navigation', { name: 'Portal' });
        await expect(nav).toBeVisible();
        // The raised centre tab reads "Train" on phones and "Workouts" in the desktop bar (D-018).
        await expect(nav.getByRole('link')).toHaveText(
          ['Home', 'Check-ins', vp.width < 768 ? 'Train' : 'Workouts', 'Messages', 'Profile'],
          { useInnerText: true },
        );
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
        await ctx.close();
      });
    }
  }
});
