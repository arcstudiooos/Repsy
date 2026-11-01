import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('equipment profile (PRD B13)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the builder warns about kit the client lacks and swaps to an alternative that fits', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Kim Kit');
    await client.context.close();
    const origin = new URL(page.url()).origin;
    const search = async (q: string) =>
      (
        (await (await page.request.get(`/api/v1/exercises?q=${encodeURIComponent(q)}`)).json()) as {
          data: { id: string; name: string }[];
        }
      ).data.find((e) => e.name === q)!;
    const bench = await search('Barbell Bench Press');
    const incline = await search('Incline Dumbbell Press');
    const res = await page.request.put(`/api/v1/exercises/${bench.id}/alternatives`, {
      data: { alternativeIds: [incline.id] },
      headers: { origin },
    });
    expect(res.ok()).toBe(true);

    await buildProgram(page, 'Kit block', [[['bench', 'Barbell Bench Press']]]);
    await assignFromClientTab(page, 'Kim Kit', 'Kit block', 1);

    // The coach records where Kim trains and with what.
    const tabs = page.getByRole('navigation', { name: 'Client sections' });
    await tabs.getByRole('link', { name: 'Overview' }).click();
    await page.getByRole('button', { name: 'Edit context' }).click();
    const dialog = page.getByRole('dialog', { name: 'Client context' });
    await dialog.getByLabel('Trains at').selectOption({ label: 'Home' });
    await dialog.getByLabel('Dumbbell', { exact: true }).check();
    await dialog.getByLabel('Band', { exact: true }).check();
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: /^Save/ }).click();
    await expect(page.getByText('Context saved.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Trains at Home · Kit: Dumbbell, Band/)).toBeVisible();

    // The builder flags the barbell and offers the dumbbell alternative.
    await tabs.getByRole('link', { name: 'Program', exact: true }).click();
    // A fresh load (the toast from saving the context goes).
    await page.goto((await page.getByRole('link', { name: 'Edit program' }).getAttribute('href'))!);
    await expect(page).toHaveURL(/\/app\/programs\/[0-9a-f-]{36}\/edit$/, { timeout: 30_000 });
    const warning = page.getByRole('note').filter({ hasText: "Not in Kim's kit" });
    await expect(warning).toContainText('Barbell. They have Dumbbell, Band.', { timeout: 30_000 });
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    }
    await warning
      .getByRole('button', { name: 'Use Incline Dumbbell Press instead of Barbell Bench Press' })
      .click();
    await expect(warning).toHaveCount(0);
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page
      .getByRole('dialog', { name: "Save changes to Kim Kit's program?" })
      .getByRole('button', { name: 'Save changes' })
      .click();
    await expect(page.getByText('Saved as version 2')).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByRole('group', { name: 'Incline Dumbbell Press' })).toBeVisible({
      timeout: 30_000,
    });
  });
});
