import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('calendar feed (PRD L7)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the client gets a private calendar link; a new one replaces it', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Cal Endar');
    const portal = client.page;
    try {
      await buildProgram(page, 'Feed block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Cal Endar', 'Feed block', 1);
      await portal.goto('/portal/profile');
      await portal.getByRole('button', { name: 'Get a calendar link' }).click();
      const link = portal.getByLabel(/Your calendar link/);
      await expect(link).toHaveValue(/\/calendar\/[A-Za-z0-9_-]+\.ics$/, { timeout: 15_000 });
      const url = new URL(await link.inputValue());
      const feed = await request.get(url.pathname);
      expect(feed.status()).toBe(200);
      expect(feed.headers()['content-type']).toContain('text/calendar');
      expect(await feed.text()).toContain('BEGIN:VEVENT');
      await expectNoAxeViolations(portal);

      await portal.getByRole('button', { name: 'Make a new link' }).click();
      await expect(link).not.toHaveValue(url.href, { timeout: 15_000 });
      expect((await request.get(url.pathname)).status()).toBe(404);
    } finally {
      await client.context.close();
    }
  });
});
