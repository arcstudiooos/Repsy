import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const localDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + days * 86_400_000),
  );

test.describe('goals (PRD B18, E9)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('coach sets a weight goal from recorded data; progress shows for coach and client', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Gia Goal');
    try {
      await openClientTab(page, 'Gia Goal', 'Progress');
      const clientId = new URL(page.url()).pathname.split('/')[3];
      const res = await page.request.post(`/api/v1/clients/${clientId}/metrics`, {
        data: { metric: 'weight', measuredOn: localDate(-1), value: 80 },
        headers: { origin: new URL(page.url()).origin },
      });
      expect(res.ok()).toBe(true);

      await page.goto(`/app/clients/${clientId}`);
      const form = page.getByRole('form', { name: 'Add a goal' });
      await expect(form).toBeVisible({ timeout: 30_000 });
      await form.getByLabel('Target (kg)').fill('76');
      await form.getByLabel('Target date').fill(localDate(60));
      await form.getByRole('button', { name: 'Add goal' }).click();
      const goals = page.getByRole('list', { name: 'Active goals' });
      await expect(goals.getByText('Body weight')).toBeVisible({ timeout: 15_000 });
      await expect(goals.getByText('On track')).toBeVisible();
      await expect(goals.getByText(/80 kg → 76 kg by/)).toBeVisible();
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
      }

      // Validation comes back on the field.
      await form.getByLabel('Target (kg)').fill('80');
      await form.getByLabel('Target date').fill(localDate(30));
      await form.getByRole('button', { name: 'Add goal' }).click();
      await expect(form.getByText('Pick a target different from the start.')).toBeVisible({
        timeout: 15_000,
      });

      await client.page.goto('/portal/progress');
      await expect(client.page.getByRole('heading', { name: 'Goals' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(client.page.getByText('On track')).toBeVisible();
      await expect(client.page.getByRole('form', { name: 'Add a goal' })).toHaveCount(0);
      await expectNoAxeViolations(client.page);

      // Archiving moves it under Archived.
      await page.getByRole('button', { name: 'Archive goal: Body weight' }).click();
      await expect(page.getByText('Archived (1)')).toBeVisible({ timeout: 15_000 });
    } finally {
      await client.context.close();
    }
  });
});
