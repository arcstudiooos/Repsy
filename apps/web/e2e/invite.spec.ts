import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  E2E_PASSWORD,
  signUpVerifiedClient,
  signUpVerifiedCoach,
  waitForEmail,
} from './helpers/users';
import { renameOwnerOrg } from './support/db';

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

      // A client visiting / lands on the portal.
      await invitee.goto('/');
      await expect(invitee).toHaveURL(/\/portal$/);

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

  test('a coach landing on / goes to /app, and /portal bounces back to /app', async ({
    page,
    request,
  }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/');
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/portal');
    await expect(page).toHaveURL(/\/app$/);
  });

  test('a client cannot switch to a real org they do not belong to', async ({
    page,
    request,
    browser,
    baseURL,
  }) => {
    const coach = await signUpVerifiedCoach(page, request);
    const origin = new URL(baseURL as string).origin;
    const clientCtx = await browser.newContext();
    const coachBCtx = await browser.newContext();
    try {
      // Org B: a second, real organization the client is not a member of.
      const coachB = await signUpVerifiedCoach(await coachBCtx.newPage(), coachBCtx.request);
      const meB = await coachBCtx.request.get('/api/v1/me');
      const orgB = ((await meB.json()) as { data: { memberships: { orgId: string }[] } }).data
        .memberships[0]?.orgId as string;
      expect(orgB).toBeTruthy();
      const orgBName = `Org B ${Date.now()}`;
      await renameOwnerOrg(coachB.email, orgBName);

      const clientPage = await clientCtx.newPage();
      await signUpVerifiedClient(clientPage, clientCtx.request, coach);
      await clientPage.goto('/');
      await expect(clientPage).toHaveURL(/\/portal$/);
      await expect(clientPage.getByText('Coached by ' + coach.orgName)).toBeVisible();

      const me = await clientPage.request.get('/api/v1/me');
      const memberships = ((await me.json()) as { data: { memberships: { orgId: string }[] } }).data
        .memberships;
      expect(memberships.map((m) => m.orgId)).not.toContain(orgB);

      const res = await clientPage.request.post('/api/v1/org/switch', {
        data: { orgId: orgB },
        headers: { origin },
      });
      expect(res.status()).toBe(404);
      expect(res.headers()['set-cookie'] ?? '').not.toContain('kinetic_org');

      await clientPage.goto('/portal');
      await expect(clientPage).toHaveURL(/\/portal$/);
      await expect(clientPage.getByText('Coached by ' + coach.orgName)).toBeVisible();
      await expect(clientPage.getByText('Coached by ' + orgBName)).toHaveCount(0);
    } finally {
      await clientCtx.close();
      await coachBCtx.close();
    }
  });

  test('coach sends, revokes and resends an invite from the UI', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    await page.goto('/app/clients');
    const email = `ui-invite-${Date.now()}@example.test`;
    await page.getByRole('button', { name: 'Add client' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add client' });
    await dialog.getByLabel('Name').fill('Uma Ui');
    await dialog.getByLabel('Email', { exact: true }).fill(email);
    await expect(dialog.getByLabel('Send invite email now')).toBeChecked();
    await dialog.getByRole('button', { name: 'Add client' }).click();
    await expect(dialog).toBeHidden();

    const row = page.getByRole('row', { name: /Uma Ui/ });
    await expect(row.getByText('Invited · pending')).toBeVisible();
    const first = await waitForEmail(request, email, 'client_invite');
    const oldLink = /https?:\/\/\S+\/invite\/\S+/.exec(first.text)?.[0] as string;
    expect(oldLink).toBeTruthy();

    await row.getByRole('link', { name: 'Uma Ui' }).click();
    await expect(page.getByRole('heading', { name: 'Invitation' })).toBeVisible();
    await expect(page.getByText(/Invite sent · expires/)).toBeVisible();

    // Revoke, with confirmation.
    await page.getByRole('button', { name: 'Revoke invite' }).click();
    const confirm = page.getByRole('dialog', { name: 'Revoke this invite?' });
    await expect(confirm.getByText('The link in their email will stop working.')).toBeVisible();
    await confirm.getByRole('button', { name: 'Revoke', exact: true }).click();
    await expect(page.getByText('Not invited yet')).toBeVisible({ timeout: 30_000 });
    await page.goto('/app/clients');
    await expect(
      page.getByRole('row', { name: /Uma Ui/ }).getByText('Invited · not sent'),
    ).toBeVisible();

    const ctx = await browser.newContext();
    const stranger = await ctx.newPage();
    try {
      await stranger.goto(oldLink);
      await expect(
        stranger.getByText('This invite link is no longer active. Ask your coach for a new one.'),
      ).toBeVisible();

      // Send again: the new link works.
      await page.getByRole('link', { name: 'Uma Ui' }).click();
      await page.getByRole('button', { name: 'Send invite' }).click();
      await expect(page.getByText(/Invite sent · expires/)).toBeVisible();
      await expect
        .poll(async () => {
          const res = await request.get('/api/dev/emails');
          const { data } = (await res.json()) as { data: { to: string; text: string }[] };
          return data.filter((e) => e.to === email).length;
        })
        .toBe(2);
      const res = await request.get('/api/dev/emails');
      const { data } = (await res.json()) as {
        data: { to: string; templateKey: string; text: string }[];
      };
      const links = data
        .filter((e) => e.to === email && e.templateKey === 'client_invite')
        .map((e) => /https?:\/\/\S+\/invite\/\S+/.exec(e.text)?.[0])
        .filter((l): l is string => Boolean(l) && l !== oldLink);
      expect(links).toHaveLength(1);
      await stranger.goto(links[0] as string);
      await expect(stranger.getByRole('button', { name: 'Accept invite' })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  for (const vp of [
    { width: 375, height: 812 },
    { width: 1440, height: 900 },
  ]) {
    test(`invitation card and revoke dialog are axe-clean at ${vp.width}`, async ({
      page,
      request,
      baseURL,
    }) => {
      await page.setViewportSize(vp);
      await signUpVerifiedCoach(page, request);
      const origin = new URL(baseURL as string).origin;
      const created = await page.request.post('/api/v1/clients', {
        data: { name: 'Axe Invitee', email: `axe-${Date.now()}@example.test` },
        headers: { origin },
      });
      const { id } = ((await created.json()) as { data: { id: string } }).data;
      await page.request.post(`/api/v1/clients/${id}/invite`, { headers: { origin } });
      await page.goto(`/app/clients/${id}`);
      await expect(page.getByRole('heading', { name: 'Invitation' })).toBeVisible();
      const check = async () => {
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(
          results.violations.map(
            (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
          ),
        ).toEqual([]);
      };
      await check();
      await page.getByRole('button', { name: 'Revoke invite' }).click();
      await expect(page.getByRole('dialog', { name: 'Revoke this invite?' })).toBeVisible();
      await check();
    });
  }
});
