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

async function fillAndBlur(page: Page, exercise: string, fields: Record<string, string>) {
  const card = page.getByRole('region', { name: exercise });
  for (const [label, value] of Object.entries(fields)) {
    await card.getByLabel(label, { exact: true }).fill(value);
  }
  await card.getByRole('heading', { name: exercise }).click();
}

test.describe('exercise alternatives and swaps (PRD C4, D8)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('coach sets an alternative; the client swaps and logs it; the coach sees the swap', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Sam Swap');
    try {
      // C4: the coach adds an alternative in the library.
      await page.goto('/app/exercises?q=Barbell%20Bench%20Press');
      const item = page
        .getByRole('list', { name: 'Exercises' })
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name: 'Barbell Bench Press', exact: true }) });
      await item.getByText('Alternatives').click();
      await item.getByRole('button', { name: 'Add alternative to Barbell Bench Press' }).click();
      const picker = page.getByRole('dialog', { name: 'Alternative to Barbell Bench Press' });
      await picker.getByLabel('Search exercises').fill('incline dumbbell');
      await picker.getByRole('button', { name: 'Use Incline Dumbbell Press' }).click();
      await expect(picker).toBeHidden({ timeout: 15_000 });
      await expect(item.getByText('Incline Dumbbell Press')).toBeVisible();
      await expectNoAxeViolations(page);

      await buildProgram(page, 'Swap block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Sam Swap', 'Swap block');

      // D8: the client swaps before logging, then logs the alternative.
      const portal = client.page;
      await portal.goto('/portal');
      await portal.getByRole('link', { name: /Start workout/ }).click();
      await expect(portal).toHaveURL(/\/portal\/workouts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await portal.getByRole('button', { name: 'Start workout' }).click();
      await portal.getByRole('button', { name: 'Swap exercise: Barbell Bench Press' }).click();
      const dialog = portal.getByRole('dialog', { name: 'Swap Barbell Bench Press' });
      await dialog.getByLabel('Incline Dumbbell Press').check();
      await dialog.getByLabel('Reason').selectOption({ label: 'Equipment in use' });
      await expectNoAxeViolations(portal);
      await dialog.getByRole('button', { name: 'Swap', exact: true }).click();
      await expect(portal.getByRole('heading', { name: 'Incline Dumbbell Press' })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        portal.getByText('Swapped from Barbell Bench Press (Equipment in use)'),
      ).toBeVisible();
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(portal);
        await expectNoAxeViolations(portal);
      }
      await fillAndBlur(portal, 'Incline Dumbbell Press', {
        'Set 1 reps': '10',
        'Set 1 weight (kg)': '24',
      });
      await expect(portal.getByText('Synced').first()).toBeVisible({ timeout: 15_000 });
      // Once a set is logged the swap stays.
      await expect(portal.getByRole('button', { name: 'Undo swap' })).toHaveCount(0);
      await portal.getByRole('button', { name: 'Complete workout' }).click();
      await portal
        .getByRole('dialog', { name: 'Complete workout?' })
        .getByRole('button', { name: 'Complete', exact: true })
        .click();
      await expect(portal).toHaveURL(/scope=past$/, { timeout: 15_000 });

      // The coach sees the swap in review and on the session.
      await page.goto('/app/review');
      await expect(page.getByText('1 exercise swapped')).toBeVisible({ timeout: 30_000 });
      await openClientTab(page, 'Sam Swap', 'Sessions');
      await page.getByRole('link', { name: /Day 1/ }).first().click();
      await expect(
        page.getByText('Swapped from Barbell Bench Press (Equipment in use)'),
      ).toBeVisible({
        timeout: 30_000,
      });
      await expectNoAxeViolations(page);

      // Records credit the exercise actually done.
      await openClientTab(page, 'Sam Swap', 'Progress');
      await expect(page.getByText('Incline Dumbbell Press').first()).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await client.context.close();
    }
  });
});
