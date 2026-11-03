import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  expectNoHorizontalOverflow,
  onboardClient,
  openClientTab,
} from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

/**
 * PRD K1-K9, K15 (D-013) with the fake provider: the coach sets up payments and a package, a visitor buys it on the
 * public page through the test checkout, a cash payment is recorded for an existing client, the client sees their
 * receipt in the portal, and revenue shows on business analytics.
 */
test.describe('payments (PRD K1-K9, K15)', () => {
  test.describe.configure({ timeout: 300_000 });

  test('storefront purchase, manual payment, portal receipt and revenue', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const slug = `pay-${Date.now().toString(36)}`;
    await page.goto('/settings');
    await page.getByLabel(/Address/).fill(slug);
    await page.getByLabel('Page is live').check();
    await page.getByRole('button', { name: 'Save public page' }).click();
    await expect(page.getByText(`/join/${slug}`)).toBeVisible({ timeout: 15_000 });

    await page.goto('/app/billing');
    // A click before hydration submits nothing: retry until the currency is saved (shown as text).
    await expect(async () => {
      await page.getByLabel('Currency').selectOption('USD');
      await page.getByRole('button', { name: 'Save settings' }).click();
      await expect(page.getByRole('combobox', { name: 'Currency' })).toBeHidden({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Use test payments' }).click();
    await expect(page.getByText(/Connected to/)).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'New package' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Monthly coaching');
    await dialog.getByLabel('Recurring').check();
    await dialog.getByLabel(/^Price/).fill('99');
    await dialog.getByRole('button', { name: 'Create package' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText('Monthly coaching')).toBeVisible();
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    }

    // A visitor buys it on the public page; the test checkout stands in for the provider.
    const visitor = await browser.newContext();
    const v = await visitor.newPage();
    try {
      await v.goto(`/join/${slug}`);
      await expect(v.getByText('Monthly coaching')).toBeVisible({ timeout: 30_000 });
      await v.getByText('Monthly coaching').click(); // opens the package's details
      const buy = v.getByRole('form', { name: 'Buy Monthly coaching' });
      await buy.getByLabel('Your name').fill('Bea Buyer');
      await buy.getByLabel('Email').fill(`bea-${Date.now()}@example.test`);
      await buy.getByRole('button', { name: 'Continue to payment' }).click();
      await expect(v.getByRole('heading', { name: 'Test checkout' })).toBeVisible({
        timeout: 30_000,
      });
      await expectNoAxeViolations(v);
      await v.getByRole('button', { name: 'Pay (test)' }).click();
      await expect(v.getByRole('heading', { name: 'Thank you' })).toBeVisible({ timeout: 30_000 });
    } finally {
      await visitor.close();
    }

    await page.goto('/app/clients');
    await expect(page.getByRole('link', { name: 'Bea Buyer' }).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.goto('/app/billing');
    await expect(page.getByText('R-000001')).toBeVisible({ timeout: 30_000 });

    // A cash payment for a client who joined by invite, then their receipt in the portal.
    const client = await onboardClient(page, request, browser, 'Cass Cash');
    try {
      await openClientTab(page, 'Cass Cash', 'Billing');
      await expect(page.getByLabel('For')).toContainText('New: Monthly coaching');
      await page.getByLabel('For').selectOption({ index: 0 });
      await page.getByLabel('Paid by').selectOption('cash');
      await page.getByRole('button', { name: 'Record payment' }).click();
      await expect(page.getByText('Payment recorded')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('R-000002')).toBeVisible({ timeout: 15_000 });

      await client.page.goto('/portal/billing');
      await expect(client.page.getByRole('heading', { name: 'Billing' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(client.page.getByText('Monthly coaching').first()).toBeVisible();
      await expectNoAxeViolations(client.page);
      await client.page.getByRole('link', { name: 'R-000002' }).click();
      await expect(client.page.getByText(/99\.00/).first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await client.context.close();
    }

    await page.goto('/app/analytics/business');
    await expect(page.getByRole('heading', { name: 'Revenue' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Active subscriptions')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
