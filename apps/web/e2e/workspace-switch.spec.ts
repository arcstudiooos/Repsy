import { expect, test } from '@playwright/test';
import { clickUntilURL } from './helpers/journey';
import { signUpVerifiedCoach, waitForEmail } from './helpers/users';
import { renameOwnerOrg } from './support/db';

test.describe('dual-role workspace switching', () => {
  test('an owner who accepts another org invite lands on the portal and switches back to their coach workspace', async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    const origin = new URL(baseURL as string).origin;
    const ownerA = await signUpVerifiedCoach(page, request);
    const stamp = Date.now();
    const orgAName = `Alpha Gym ${stamp}`;
    const orgBName = `Bravo Gym ${stamp}`;
    await renameOwnerOrg(ownerA.email, orgAName);

    // Org B invites owner A as a client.
    const coachBCtx = await browser.newContext();
    try {
      const coachBPage = await coachBCtx.newPage();
      const coachB = await signUpVerifiedCoach(coachBPage, coachBCtx.request);
      await renameOwnerOrg(coachB.email, orgBName);
      const created = await coachBCtx.request.post('/api/v1/clients', {
        data: { name: 'Alex Owner', email: ownerA.email },
        headers: { origin },
      });
      expect(created.status()).toBe(201);
      const { id } = ((await created.json()) as { data: { id: string } }).data;
      const issued = await coachBCtx.request.post(`/api/v1/clients/${id}/invite`, {
        headers: { origin },
      });
      expect(issued.status()).toBe(201);
    } finally {
      await coachBCtx.close();
    }

    const mail = await waitForEmail(request, ownerA.email, 'client_invite');
    const link = /https?:\/\/\S+\/invite\/\S+/.exec(mail.text)?.[0];
    expect(link).toBeTruthy();

    // Owner A is still signed in: the signed-in acceptance sets org B as the active org.
    await page.goto(link as string);
    await page.getByLabel('I agree to share my training data with').check();
    await page.getByRole('button', { name: 'Accept invite' }).click();
    await expect(page).toHaveURL(/\/portal$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();

    // The coach shell does not dead-end: with org B active, /app sends a client back to the portal.
    await page.goto('/app/clients');
    await expect(page).toHaveURL(/\/portal$/);

    await clickUntilURL(
      page,
      page.getByRole('link', { name: 'Switch workspace' }),
      /\/select-org$/,
    );
    await page.getByRole('button', { name: new RegExp(orgAName) }).click();
    await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Coach dashboard' })).toBeVisible();

    // And back: the portal shell sends a coach role to /app; the switcher is in the coach shell too.
    await page.goto('/portal');
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole('link', { name: 'Switch workspace' })).toBeVisible();

    // Signing out forgets the active org.
    expect((await page.context().cookies()).some((c) => c.name === 'repsy_org')).toBe(true);
    // Sign out lives in the account menu behind the user card (D-018).
    await page.getByRole('button', { name: /^Account menu for/ }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    expect((await page.context().cookies()).some((c) => c.name === 'repsy_org')).toBe(false);
  });
});
