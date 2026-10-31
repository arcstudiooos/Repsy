import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

/** A local date (YYYY-MM-DD) `days` from today in the runner's zone, which the client accepted with. */
function localDate(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
const longDate = (d: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));

test.describe('client calendar (PRD C16)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('coach sees the month, moves a workout; the client sees the new day', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Cal Endar');
    try {
      await buildProgram(page, 'Calendar block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Cal Endar', 'Calendar block', 1);
      await openClientTab(page, 'Cal Endar', 'Calendar');
      const today = localDate(0);
      const target = localDate(2);
      await expect(
        page.getByRole('button', { name: `Move Day 1 on ${longDate(today)}` }).first(),
      ).toBeAttached({ timeout: 30_000 });
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }

      await page
        .getByRole('button', { name: `Move Day 1 on ${longDate(today)}` })
        .locator('visible=true')
        .click();
      const dialog = page.getByRole('dialog', { name: 'Move Day 1' });
      await dialog.getByLabel('New day').fill(target);
      await expectNoAxeViolations(page);
      await dialog.getByRole('button', { name: 'Move workout' }).click();
      await expect(page.getByText(`Moved "Day 1" to ${longDate(target)}.`)).toBeVisible({
        timeout: 15_000,
      });

      await page.goto(`${new URL(page.url()).pathname}?month=${target.slice(0, 7)}`);
      await expect(
        page.getByRole('button', { name: `Move Day 1 on ${longDate(target)}` }).first(),
      ).toBeAttached({ timeout: 15_000 });

      const portal = client.page;
      await portal.goto(`/portal/calendar?month=${target.slice(0, 7)}`);
      await expect(portal.getByRole('heading', { name: 'Calendar' })).toBeVisible({
        timeout: 30_000,
      });
      // Clients see the workout on its new day but cannot move it.
      await portal.setViewportSize({ width: 375, height: 812 });
      await expect(portal.getByRole('heading', { name: longDate(target) })).toBeVisible();
      await expect(portal.getByRole('button', { name: /^Move / })).toHaveCount(0);
      await expectNoAxeViolations(portal);
      await expectNoHorizontalOverflow(portal);
    } finally {
      await client.context.close();
    }
  });
});
