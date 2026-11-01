import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, onboardClient, openClientTab } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const localDate = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(Date.now() + days * 86_400_000),
  );

test.describe('personal reply toolkit (PRD F7)', () => {
  test.describe.configure({ timeout: 180_000 });

  test('a saved reply fills in the client’s real numbers; context shows beside the inbox thread', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Pia Placeholder');
    try {
      await openClientTab(page, 'Pia Placeholder', 'Progress');
      const clientId = new URL(page.url()).pathname.split('/')[3];
      const origin = new URL(page.url()).origin;
      expect(
        (
          await page.request.post(`/api/v1/clients/${clientId}/metrics`, {
            data: { metric: 'weight', measuredOn: localDate(-1), value: 72.5 },
            headers: { origin },
          })
        ).ok(),
      ).toBe(true);
      expect(
        (
          await page.request.patch(`/api/v1/clients/${clientId}/context`, {
            data: { goals: 'Run a 10k in spring' },
            headers: { origin },
          })
        ).ok(),
      ).toBe(true);

      await page.goto('/settings');
      const add = page.getByRole('form', { name: 'New saved reply' });
      await add.getByLabel('Title').fill('Weigh-in');
      await add.getByLabel('Reply').fill('Nice, {first_name}: {weight} this week. {unknown}');
      await add.getByRole('button', { name: 'Add saved reply' }).click();
      await expect(page.getByText('Saved reply added.')).toBeVisible({ timeout: 15_000 });

      // The client's Messages tab.
      await openClientTab(page, 'Pia Placeholder', 'Messages');
      await page.getByLabel('Insert a saved reply').selectOption({ label: 'Weigh-in' });
      await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
        'Nice, Pia: 72.5 kg this week. {unknown}',
      );

      // The inbox shows the client's goals beside the thread.
      await page.goto('/app/messages');
      await page
        .getByRole('link', { name: /Pia Placeholder/ })
        .first()
        .click();
      await expect(page.getByText('Run a 10k in spring')).toBeVisible({ timeout: 30_000 });
      await expectNoAxeViolations(page);
    } finally {
      await client.context.close();
    }
  });
});
