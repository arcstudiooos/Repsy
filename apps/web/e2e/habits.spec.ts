import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('habits and tasks (PRD G1-G3)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('coach assigns a habit and a task; the client ticks both; the coach sees it', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Hana Habit');
    try {
      await openClientTab(page, 'Hana Habit', 'Habits');
      const form = page.getByRole('form', { name: 'Assign a habit or task' });
      await form.getByLabel('Title').fill('Walk 8,000 steps');
      await form.getByRole('button', { name: 'Assign habit' }).click();
      const list = page.getByRole('list', { name: 'Habits and tasks' });
      await expect(list.getByText('Walk 8,000 steps')).toBeVisible({ timeout: 15_000 });
      await form.getByLabel('Task (once)').check();
      await form.getByLabel('Title').fill('Send a photo of your home gym');
      await form.getByRole('button', { name: 'Assign task' }).click();
      await expect(list.getByText('Send a photo of your home gym')).toBeVisible({
        timeout: 15_000,
      });
      // PRD G12: water as a habit with a daily target, from a preset.
      await form.getByLabel('Habit (repeats)').check();
      await form.getByRole('button', { name: 'Water' }).click();
      await expect(form.getByLabel('Title')).toHaveValue('Drink water');
      await expect(form.getByLabel('Target (optional)')).toHaveValue('8');
      await form.getByRole('button', { name: 'Assign habit' }).click();
      await expect(list.getByText('Drink water')).toBeVisible({ timeout: 15_000 });
      await expectNoAxeViolations(page);

      const portal = client.page;
      await portal.goto('/portal');
      const habit = portal.getByRole('button', { name: /Walk 8,000 steps/ });
      await expect(habit).toHaveAttribute('aria-pressed', 'false', { timeout: 30_000 });
      await habit.click();
      await expect(habit).toHaveAttribute('aria-pressed', 'true');
      // The button is disabled while its save is in flight: wait for the server to confirm it.
      await expect(habit).toBeEnabled({ timeout: 15_000 });
      const task = portal.getByRole('button', { name: /Send a photo of your home gym/ });
      await task.click();
      await expect(task).toHaveAttribute('aria-pressed', 'true');
      await expect(task).toBeEnabled({ timeout: 15_000 });
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(portal);
        await expectNoHorizontalOverflow(portal);
      }
      // The ticks survive a reload.
      await portal.reload();
      await expect(portal.getByRole('button', { name: /Walk 8,000 steps/ })).toHaveAttribute(
        'aria-pressed',
        'true',
        { timeout: 30_000 },
      );

      await page.reload();
      await expect(list.getByText(/1 this week/)).toBeVisible({ timeout: 15_000 });
      await expect(list.getByText('Done', { exact: true })).toBeVisible();
      await expect(list.getByText('Done on 1 of the last 84 days.')).toBeVisible();

      // PRD G2: the 12-week map (a table) and completion per habit.
      const map = page.getByRole('table', { name: 'Habits met per day, last 12 weeks' });
      await expect(map.getByRole('row')).toHaveCount(13);
      // Two habits today (the walk and the water); the walk was ticked.
      await expect(map.getByRole('cell', { name: '1/2' })).toHaveCount(1);
      await expect(
        page.getByRole('list', { name: 'Completion per habit' }).getByText('100% (1 of 1 days)'),
      ).toBeVisible();
      await expect(
        page.getByRole('list', { name: 'Completion per habit' }).getByText('0% (0 of 1 days)'),
      ).toBeVisible();
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }
    } finally {
      await client.context.close();
    }
  });
});
