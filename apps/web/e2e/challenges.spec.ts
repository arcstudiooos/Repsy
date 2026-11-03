import { expect, test } from '@playwright/test';
import {
  clickUntilURL,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const localDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + days * 86_400_000),
  );

test.describe('challenges and leaderboards (PRD H9)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the coach starts a challenge; a client joins and appears on the leaderboard', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Lea Leader');
    const portal = client.page;
    try {
      await page.goto('/app/challenges');
      await page.getByLabel('Challenge name').fill('30-day workout challenge');
      await page.getByLabel('What counts').selectOption({ label: 'Most workouts completed' });
      await page.getByLabel('Starts').fill(localDate(-1));
      await page.getByLabel('Ends').fill(localDate(29));
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Create challenge' }).click();
      await expect(page).toHaveURL(/\/app\/challenges\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await expect(page.getByText('No one has joined yet.')).toBeVisible();

      await portal.goto('/portal');
      await clickUntilURL(
        portal,
        portal.getByRole('link', { name: 'Challenges' }).last(),
        /\/portal\/challenges$/,
      );
      await clickUntilURL(
        portal,
        portal.getByRole('link', { name: '30-day workout challenge' }),
        /\/portal\/challenges\/[0-9a-f-]{36}$/,
      );
      await expect(
        portal.getByLabel('Show me on the leaderboard (first name and initial)'),
      ).toBeChecked();
      const joined = portal.waitForResponse(
        (r) => r.url().includes('/participation') && r.request().method() === 'PUT',
      );
      await portal.getByRole('button', { name: 'Join the challenge' }).click();
      expect((await joined).status()).toBe(200);
      const board = portal.getByRole('list', { name: 'Leaderboard' });
      await expect(board.getByText('Lea L. (you)')).toBeVisible({ timeout: 15_000 });
      await expect(board.getByText('0 workouts')).toBeVisible();
      for (const width of [375, 1440]) {
        await portal.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(portal);
        await expectNoAxeViolations(portal);
      }

      await page.reload();
      await expect(
        page.getByRole('list', { name: 'Leaderboard' }).getByText('Lea Leader'),
      ).toBeVisible({ timeout: 15_000 });
      await expectNoAxeViolations(page);
    } finally {
      await client.context.close();
    }
  });
});
