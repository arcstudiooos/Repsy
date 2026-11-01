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

test.describe('anchored messages (PRD H3)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the client messages about a workout; both see a chip linking back to it', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Reo Anchor');
    const portal = client.page;
    try {
      await buildProgram(page, 'Anchor block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Reo Anchor', 'Anchor block', 1);

      await portal.goto('/portal');
      await portal.getByRole('link', { name: /Start workout/ }).click();
      await expect(portal).toHaveURL(/\/portal\/workouts\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      const workoutPath = new URL(portal.url()).pathname;
      await portal.getByRole('link', { name: 'Message your coach about this workout' }).click();
      await expect(portal.getByText(/^Re: Day 1, /)).toBeVisible({ timeout: 30_000 });
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(portal);
        await expectNoAxeViolations(portal);
      }
      await portal
        .getByLabel('Message', { exact: true })
        .fill('My shoulder felt tight on this one.');
      await portal.getByRole('button', { name: 'Send' }).click();
      const sent = portal.getByRole('list', { name: 'Messages' }).getByRole('listitem').filter({
        hasText: 'My shoulder felt tight',
      });
      await expect(sent.getByRole('link', { name: /^Re: Day 1, / })).toHaveAttribute(
        'href',
        workoutPath,
        { timeout: 15_000 },
      );
      // The chip in the composer is gone after sending.
      await expect(portal.getByRole('button', { name: /^Remove Re:/ })).toHaveCount(0);

      await openClientTab(page, 'Reo Anchor', 'Messages');
      const link = page.getByRole('link', { name: /^Re: Day 1, / });
      await expect(link).toBeVisible({ timeout: 30_000 });
      await expect(link).toHaveAttribute(
        'href',
        /\/app\/clients\/[0-9a-f-]{36}\/sessions\/[0-9a-f-]{36}$/,
      );
      await expectNoAxeViolations(page);
    } finally {
      await client.context.close();
    }
  });
});
