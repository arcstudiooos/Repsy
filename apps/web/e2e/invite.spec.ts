import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, signUpVerifiedCoach, waitForEmail } from './helpers/users';

test.describe('client invite', () => {
  test('coach invites, client accepts, lands on the portal, roster shows Active', async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    await signUpVerifiedCoach(page, request);
    const origin = new URL(baseURL as string).origin;
    const email = `invitee-${Date.now()}@example.test`;

    const created = await page.request.post('/api/v1/clients', {
      data: { name: 'Ivy Invitee', email },
      headers: { origin },
    });
    expect(created.status()).toBe(201);
    const { id } = ((await created.json()) as { data: { id: string } }).data;
    const issued = await page.request.post(`/api/v1/clients/${id}/invite`, { headers: { origin } });
    expect(issued.status()).toBe(201);

    const mail = await waitForEmail(request, email, 'client_invite');
    const link = /https?:\/\/\S+\/invite\/\S+/.exec(mail.text)?.[0];
    expect(link).toBeTruthy();

    // The invitee has no session: a fresh browser context.
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const invitee = await context.newPage();
    try {
      await invitee.goto(link as string);
      await expect(invitee.getByRole('heading', { level: 1 })).toContainText('Casey Coach Org');
      await expect(invitee.getByLabel('Email')).toHaveValue(email);
      await expect(invitee.getByLabel('Email')).toHaveAttribute('readonly', '');

      const results = await new AxeBuilder({ page: invitee })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);
      const overflow = await invitee.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      await invitee.getByLabel('Choose a password').fill(E2E_PASSWORD);
      await invitee.getByLabel('Units').selectOption('lb');
      await invitee.getByLabel('Goals (optional)').fill('Run a 10k');
      await invitee.getByLabel('I agree to share my training data with').check();
      await invitee.getByRole('button', { name: 'Accept invite' }).click();
      await expect(invitee).toHaveURL(/\/portal$/, { timeout: 20_000 });
      await expect(invitee.getByRole('heading', { name: 'Home' })).toBeVisible();

      // The link is single-use.
      await invitee.goto(link as string);
      await expect(invitee.getByText('This invite link has already been used.')).toBeVisible();
      await expect(invitee.getByRole('button', { name: 'Accept invite' })).toHaveCount(0);
    } finally {
      await context.close();
    }

    await page.goto('/app/clients');
    const row = page.getByRole('row', { name: /Ivy Invitee/ });
    await expect(row.getByText('Active')).toBeVisible();
  });

  test('an unknown invite link shows an error and no form', async ({ page }) => {
    await page.goto(`/invite/${'z'.repeat(43)}`);
    await expect(page.getByText('This invite link is not valid.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept invite' })).toHaveCount(0);
  });

  test('a coach landing on / goes to /app; a client goes to /portal', async ({ page, request }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/');
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/portal');
    await expect(page).toHaveURL(/\/app$/);
  });
});
