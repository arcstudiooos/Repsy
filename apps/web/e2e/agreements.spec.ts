import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, onboardClient } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

const TEXT = 'I train at my own risk and will tell my coach about any injury or illness.';

test.describe('agreements and waivers (PRD B14)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('the client accepts the waiver before the portal opens, and again after it changes', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const client = await onboardClient(page, request, browser, 'Wai Ver');
    const portal = client.page;
    try {
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Add an agreement' }).click();
      await page.getByLabel('Title').last().fill('Liability waiver');
      await page.getByLabel('Text clients read and accept').fill(TEXT);
      await page.getByRole('button', { name: 'Publish' }).click();
      await expect(page.getByText('version 1')).toBeVisible({ timeout: 15_000 });

      await portal.goto('/portal');
      await expect(portal.getByRole('heading', { name: 'Before you start' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(portal.getByText(TEXT)).toBeVisible();
      await expectNoAxeViolations(portal);
      await portal.getByRole('button', { name: 'I accept the Liability waiver' }).click();
      await expect(portal.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible({
        timeout: 30_000,
      });

      await page.goto('/app/clients');
      await page.getByRole('link', { name: 'Wai Ver' }).first().click();
      await expect(page.getByText(/accepted version 1 on/)).toBeVisible({ timeout: 30_000 });

      await page.goto('/settings');
      await page.getByRole('button', { name: 'Edit Liability waiver' }).click();
      await page.getByLabel('Text clients read and accept').fill(`${TEXT} Updated for 2027.`);
      await page.getByRole('button', { name: 'Save agreement' }).click();
      await expect(page.getByText('version 2')).toBeVisible({ timeout: 15_000 });
      await portal.goto('/portal');
      await expect(portal.getByText(/Updated for 2027/)).toBeVisible({ timeout: 30_000 });
    } finally {
      await client.context.close();
    }
  });
});
