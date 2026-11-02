import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, expectNoHorizontalOverflow } from './helpers/journey';
import { signUpVerifiedCoach } from './helpers/users';

test.describe('public page and leads (PRD B15, B16)', () => {
  test.describe.configure({ timeout: 240_000 });

  test('a visitor applies on the public page; the coach converts the lead', async ({
    page,
    request,
    browser,
  }) => {
    await signUpVerifiedCoach(page, request);
    const slug = `coach-${Date.now().toString(36)}`;
    await page.goto('/settings');
    await page.getByLabel(/Address/).fill(slug);
    await page.getByLabel('About you').fill('I help busy people get strong.');
    await page.getByLabel('What you offer').fill('Online coaching, monthly.');
    await page.getByLabel('Page is live').check();
    await page.getByRole('button', { name: 'Save public page' }).click();
    await expect(page.getByText(`/join/${slug}`)).toBeVisible({ timeout: 15_000 });

    const visitor = await browser.newContext();
    const v = await visitor.newPage();
    try {
      await v.goto(`/join/${slug}`);
      await expect(v.getByText('I help busy people get strong.')).toBeVisible({ timeout: 30_000 });
      for (const width of [375, 1440]) {
        await v.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(v);
        await expectNoAxeViolations(v);
      }
      await v.getByLabel('Your name').fill('Lee Lead');
      await v.getByLabel('Email').fill(`lee-${Date.now()}@example.test`);
      await v.getByLabel('What would you like help with?').fill('My first pull-up');
      await v.waitForTimeout(3200); // a human takes a few seconds; faster is treated as a bot
      await v.getByRole('button', { name: 'Apply' }).click();
      await expect(v.getByText(/has your application/)).toBeVisible({ timeout: 15_000 });
    } finally {
      await visitor.close();
    }

    await page.goto('/app/leads');
    await expect(page.getByText('Lee Lead', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('My first pull-up')).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByLabel('Stage for Lee Lead').selectOption({ label: 'Call booked' });
    await expect(page.getByRole('heading', { name: 'Call booked (1)' })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Convert to client: Lee Lead' }).click();
    await expect(page.getByText('Now a client.')).toBeVisible({ timeout: 15_000 });
    await page.goto('/app/clients');
    await expect(page.getByRole('link', { name: 'Lee Lead' }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
