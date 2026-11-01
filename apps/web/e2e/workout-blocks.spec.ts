import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('workout blocks (PRD C8)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the coach builds a superset; print and the client show A1, A2 and the block', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Bea Block');
    await buildProgram(page, 'Blocks', [
      [
        ['bench', 'Barbell Bench Press'],
        ['incline dumbbell', 'Incline Dumbbell Press'],
        ['plank', 'Plank'],
      ],
    ]);
    const day = page.getByRole('group', { name: 'Day 1', exact: true });
    const bench = day.getByRole('group', { name: 'Barbell Bench Press' });
    await bench.getByLabel('Block').selectOption({ label: 'Superset' });
    await bench.getByLabel('Rounds').fill('3');
    await day
      .getByRole('group', { name: 'Incline Dumbbell Press' })
      .getByLabel('Group with the exercise above (superset or circuit)')
      .check();
    // A joined exercise has no block settings of its own.
    await expect(
      day.getByRole('group', { name: 'Incline Dumbbell Press' }).getByLabel('Block'),
    ).toHaveCount(0);
    const plank = day.getByRole('group', { name: 'Plank' });
    await plank.getByLabel('Block').selectOption({ label: 'EMOM' });
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(plank.getByText('Enter the minutes.')).toBeVisible({ timeout: 15_000 });
    await plank.getByLabel('Minutes').fill('10');
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Saved as version 2')).toBeVisible({ timeout: 30_000 });
    const programPath = new URL(page.url()).pathname.replace(/\/edit$/, '');

    await page.goto(`${programPath}/print`);
    await expect(page.getByText('A · Superset · 3 rounds')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('rowheader', { name: 'A2 Incline Dumbbell Press' })).toBeVisible();
    await expect(page.getByText('B · EMOM 10 min')).toBeVisible();

    await assignFromClientTab(page, 'Bea Block', 'Blocks', 1);
    const portal = client.page;
    await portal.goto('/portal');
    await portal.getByRole('link', { name: /Start workout/ }).click();
    await portal.getByRole('button', { name: 'Start workout' }).click();
    await expect(portal.getByText('A · Superset · 3 rounds')).toBeVisible({ timeout: 30_000 });
    await expect(portal.getByRole('heading', { name: 'A1 Barbell Bench Press' })).toBeVisible();
    await expect(portal.getByRole('heading', { name: 'A2 Incline Dumbbell Press' })).toBeVisible();
    await expect(portal.getByRole('heading', { name: 'B Plank' })).toBeVisible();
    for (const width of [375, 1440]) {
      await portal.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(portal);
      await expectNoAxeViolations(portal);
    }
    await client.context.close();
  });
});
