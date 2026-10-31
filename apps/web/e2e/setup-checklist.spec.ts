import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('dashboard setup checklist (PRD A5)', () => {
  test.describe.configure({ timeout: 120_000 });

  test('a new coach sees the steps, ticks one by doing it, hides and re-shows the list', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'Get set up (0 of 7 done)' })).toBeVisible({
      timeout: 30_000,
    });
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    }

    // Doing a step ticks it: add a client through the API.
    const res = await page.request.post('/api/v1/clients', {
      data: { name: 'Setup Sam', email: `setup-${Date.now().toString(36)}@example.test` },
      headers: { origin: new URL(page.url()).origin },
    });
    expect(res.status()).toBe(201);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Get set up (1 of 7 done)' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Add a client (done)')).toBeAttached();

    await page.getByRole('button', { name: 'Hide checklist' }).click();
    const show = page.getByRole('button', { name: 'Show the setup checklist (1 of 7 done)' });
    await expect(show).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Get set up/ })).toHaveCount(0);
    await page.reload();
    await expect(show).toBeVisible({ timeout: 15_000 });
    await show.click();
    await expect(page.getByRole('heading', { name: 'Get set up (1 of 7 done)' })).toBeVisible({
      timeout: 15_000,
    });
  });
});
