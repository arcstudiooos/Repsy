import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const localDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + days * 86_400_000),
  );
const longDate = (d: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));
const isSunday = () => new Date(`${localDate(0)}T00:00:00Z`).getUTCDay() === 0;

test.describe('clients move a workout within the week (PRD D14)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('owner allows it; the client moves today’s workout to tomorrow; the coach gets a review item', async ({
    page,
    request,
    browser,
  }) => {
    test.skip(isSunday(), 'No later day left in the week on a Sunday.');
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Mo Ver');
    try {
      await buildProgram(page, 'Move block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Mo Ver', 'Move block');
      const today = localDate(0);
      const tomorrow = localDate(1);

      // Off by default: no Move for the client.
      const portal = client.page;
      await portal.goto(`/portal/calendar?month=${today.slice(0, 7)}`);
      await expect(portal.getByRole('heading', { name: 'Calendar' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(portal.getByRole('button', { name: /^Move / })).toHaveCount(0);

      await page.goto('/settings');
      const form = page.getByRole('form', { name: 'Review rules' });
      await form.getByLabel('Clients can move workouts').check();
      await form.getByRole('button', { name: 'Save review rules' }).click();
      await expect(page.getByText('Review rules saved.')).toBeVisible({ timeout: 15_000 });

      await portal.reload();
      await expect(
        portal.getByText(
          'You can move a workout that has not started to another day in the same week.',
        ),
      ).toBeVisible({ timeout: 30_000 });
      await portal
        .getByRole('button', { name: `Move Day 1 on ${longDate(today)}` })
        .locator('visible=true')
        .click();
      const dialog = portal.getByRole('dialog', { name: 'Move Day 1' });
      await expect(dialog.getByLabel(/Also move every later workout/)).toHaveCount(0);
      await dialog.getByLabel('New day').fill(tomorrow);
      await expectNoAxeViolations(portal);
      await dialog.getByRole('button', { name: 'Move workout' }).click();
      await expect(portal.getByText(`Moved "Day 1" to ${longDate(tomorrow)}.`)).toBeVisible({
        timeout: 15_000,
      });

      // The review queue, filtered to this rule, lists the client.
      await page.goto('/app/review?rule=workout_moved');
      await expect(page.getByText('Mo Ver').first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await client.context.close();
    }
  });
});
