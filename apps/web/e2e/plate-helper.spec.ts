import { expect, test } from '@playwright/test';
import {
  assignFromClientTab,
  buildProgram,
  expectNoAxeViolations,
  onboardClient,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('plate and unit helper (PRD D18)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the client sees the plates per side and the weight in the other unit', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Pia Plates');
    const portal = client.page;
    try {
      await buildProgram(page, 'Plate block', [[['bench', 'Barbell Bench Press']]]);
      await assignFromClientTab(page, 'Pia Plates', 'Plate block', 1);
      await portal.goto('/portal');
      await portal.getByRole('link', { name: /Start workout/ }).click();
      await portal.getByRole('button', { name: 'Start workout' }).click();
      const card = portal.getByRole('region', { name: 'Barbell Bench Press' });
      await card.getByText('Plates and units').click();
      await card.getByLabel('Total (kg)').fill('102.5');
      await expect(card.getByRole('status').filter({ hasText: 'Each side' })).toHaveText(
        'Each side: 1 × 25, 1 × 15, 1 × 1.25 kg. 102.5 kg = 226 lb.',
      );
      await expectNoAxeViolations(portal);
    } finally {
      await client.context.close();
    }
  });
});
