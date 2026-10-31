/**
 * The R1 closed loop (Sprint 4 DoD): invite client → assign program → log workout → attention needed → check-in →
 * next action (private note, resolve). The client never sees the coach's note.
 */
import { expect, test, type Page } from '@playwright/test';
import { issueCheckinNow } from './support/db';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
  todayWeekday,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const CLIENT = 'Lou Loop';
const NOTE = 'Ask about sleep at the next session';

async function fillAndBlur(page: Page, exercise: string, fields: Record<string, string>) {
  const card = page.getByRole('region', { name: exercise });
  for (const [label, value] of Object.entries(fields)) {
    await card.getByLabel(label, { exact: true }).fill(value);
  }
  await card.getByRole('heading', { name: exercise }).click();
}

test.describe('closed loop (Sprint 4)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('invite → assign → log → check-in → review → note → history → resolve', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, CLIENT);
    try {
      await buildProgram(page, 'Loop block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, CLIENT, 'Loop block');

      // The client logs and completes today's workout.
      const portal = client.page;
      await portal.goto('/portal');
      await portal.getByRole('link', { name: /Start workout/ }).click();
      await expect(portal).toHaveURL(/\/portal\/workouts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await portal.getByRole('button', { name: 'Start workout' }).click();
      await fillAndBlur(portal, 'Barbell Bench Press', {
        'Set 1 reps': '10',
        'Set 1 weight (kg)': '50',
      });
      await expect(portal.getByText('Synced').first()).toBeVisible({ timeout: 15_000 });
      await portal.getByRole('button', { name: 'Complete workout' }).click();
      await portal
        .getByRole('dialog', { name: 'Complete workout?' })
        .getByRole('button', { name: 'Complete', exact: true })
        .click();
      await expect(portal).toHaveURL(/scope=past$/, { timeout: 15_000 });

      // Weekly check-in: scheduled by the coach, answered by the client.
      await openClientTab(page, CLIENT, 'Check-ins');
      await page.getByLabel('Check-in day').selectOption({ label: todayWeekday() });
      await page.getByRole('button', { name: 'Save day' }).click();
      await expect(page.getByText('Check-in day saved')).toBeVisible({ timeout: 15_000 });
      await issueCheckinNow(CLIENT);
      await portal.goto('/portal');
      await portal.getByRole('link', { name: 'Fill in check-in' }).click();
      await portal
        .getByRole('group', { name: /Sleep this week/ })
        .getByLabel('1')
        .check();
      await portal.getByRole('button', { name: 'Send check-in' }).click();
      await expect(portal.getByText('Check-in sent to your coach. Thank you.')).toBeVisible({
        timeout: 15_000,
      });

      // Attention needed: the dashboard and queue show the new check-in.
      await page.goto('/app');
      await expect(page.getByRole('heading', { name: 'Needs attention (1)' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole('link', { name: 'New check-in sent' })).toBeVisible();

      // Next action: a private note, then the history shows it apart from the client's activity.
      await openClientTab(page, CLIENT, 'Notes');

      await page.getByLabel('New note').fill(NOTE);
      await page.getByRole('button', { name: 'Add note' }).click();
      // The saved note in the list (the form clears once the server has it).
      await expect(page.getByRole('listitem').filter({ hasText: NOTE })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByLabel('New note')).toHaveValue('');
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(page);
        await expectNoHorizontalOverflow(page);
      }
      await openClientTab(page, CLIENT, 'History');
      const history = page.getByRole('list', { name: 'History' });
      await expect(history.getByText(/^Private note by /)).toBeVisible({
        timeout: 30_000,
      });
      await expect(history.getByText(NOTE)).toBeVisible();
      await expect(history.getByText('Check-in answered')).toBeVisible();
      await expect(history.getByText(/^Completed: /)).toBeVisible();
      await expect(history.getByText(/^Program assigned: Loop block/)).toBeVisible();
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoAxeViolations(page);
        await expectNoHorizontalOverflow(page);
      }

      // Resolve the queue item with a reason.
      await page.goto('/app/review');
      await page.getByRole('button', { name: /^Resolve: New check-in sent/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Resolve this item?' });
      await dialog.getByLabel('Reason').fill('Noted sleep; will discuss');
      await dialog.getByRole('button', { name: 'Resolve' }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
      await expect(page.getByText('Nothing needs review right now.')).toBeVisible();

      // The client's portal never carries the note.
      for (const path of [
        '/portal',
        '/portal/workouts?scope=past',
        '/portal/check-ins',
        '/portal/messages',
      ]) {
        await portal.goto(path);
        await expect(portal.getByRole('main')).toBeVisible({ timeout: 30_000 });
        expect(await portal.content()).not.toContain(NOTE);
      }
    } finally {
      await client.context.close();
    }
  });
});
