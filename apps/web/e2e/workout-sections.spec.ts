import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('workout sections (PRD C9)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the coach puts exercises in warm-up and cool-down; client, print and versions show the sections', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Sec Tion');
    await buildProgram(page, 'Sectioned', [
      [
        ['plank', 'Plank'],
        ['bench', 'Barbell Bench Press'],
      ],
    ]);
    const day = page.getByRole('group', { name: 'Day 1', exact: true });
    await day
      .getByRole('group', { name: 'Plank' })
      .getByLabel('Section')
      .selectOption({ label: 'Warm-up' });
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Saved as version 2')).toBeVisible({ timeout: 30_000 });
    const programPath = new URL(page.url()).pathname.replace(/\/edit$/, '');

    await page.goto(`${programPath}/print`);
    await expect(page.getByRole('columnheader', { name: 'Warm-up' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('columnheader', { name: 'Main' })).toBeVisible();
    await page.goto(`${programPath}/versions/2`);
    await expect(page.getByText('Warm-up', { exact: true })).toBeVisible({ timeout: 30_000 });

    await assignFromClientTab(page, 'Sec Tion', 'Sectioned', 1);
    const portal = client.page;
    await portal.goto('/portal');
    await portal.getByRole('link', { name: /Start workout/ }).click();
    await expect(portal).toHaveURL(/\/portal\/workouts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const list = portal.getByRole('list').filter({ hasText: 'Barbell Bench Press' }).first();
    await expect(list.getByRole('listitem').first()).toContainText('Warm-up', { timeout: 30_000 });
    await expect(list.getByRole('listitem').nth(1)).toContainText('Main');
    await portal.getByRole('button', { name: 'Start workout' }).click();
    await expect(portal.getByRole('region', { name: 'Plank' })).toBeVisible({ timeout: 15_000 });
    await expect(portal.getByText('Warm-up', { exact: true })).toBeVisible();
    for (const width of [375, 1440]) {
      await portal.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(portal);
      await expectNoAxeViolations(portal);
    }
    await client.context.close();
  });
});
