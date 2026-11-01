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

test.describe('notes on sets and workouts (PRD D9)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('client notes a set; the coach replies; both read the thread in order', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Nell Note');
    try {
      await buildProgram(page, 'Note block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Nell Note', 'Note block');

      const portal = client.page;
      await portal.goto('/portal');
      await portal.getByRole('link', { name: /Start workout/ }).click();
      await expect(portal).toHaveURL(/\/portal\/workouts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await portal.getByRole('button', { name: 'Start workout' }).click();
      await portal.getByRole('button', { name: 'Add note on Barbell Bench Press' }).click();
      const form = portal.getByRole('form', { name: 'Add a note on Barbell Bench Press' });
      await form.getByLabel('Note').fill('Grip slipped on the last rep');
      await form.getByLabel('About').selectOption({ label: 'Set 1' });
      await expectNoAxeViolations(portal);
      await form.getByRole('button', { name: 'Add note' }).click();
      const notes = portal.getByRole('list', { name: 'Notes on Barbell Bench Press' });
      await expect(notes.getByText('Grip slipped on the last rep')).toBeVisible({
        timeout: 15_000,
      });
      await expect(notes.getByText(/^You · set 1 ·/)).toBeVisible();
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(portal);
        await expectNoAxeViolations(portal);
      }

      // The coach reads it on the session and replies.
      await openClientTab(page, 'Nell Note', 'Sessions');
      await page.getByRole('link', { name: /Day 1/ }).first().click();
      const coachNotes = page.getByRole('list', { name: 'Notes on Barbell Bench Press' });
      await expect(coachNotes.getByText('Grip slipped on the last rep')).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole('button', { name: 'Add note on Barbell Bench Press' }).click();
      const reply = page.getByRole('form', { name: 'Add a note on Barbell Bench Press' });
      await reply.getByLabel('Note').fill('Try chalk next session.');
      await reply.getByRole('button', { name: 'Add note' }).click();
      await expect(coachNotes.getByText('Try chalk next session.')).toBeVisible({
        timeout: 15_000,
      });
      await expectNoAxeViolations(page);

      await portal.reload();
      await expect(
        portal
          .getByRole('list', { name: 'Notes on Barbell Bench Press' })
          .getByText(/^Your coach ·/),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await client.context.close();
    }
  });
});
