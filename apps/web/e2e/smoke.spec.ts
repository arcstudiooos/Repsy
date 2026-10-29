import { expect, test } from '@playwright/test';

/**
 * Post-deploy smoke against a hosted environment. Skipped unless STAGING_URL is set.
 * Optional SMOKE_EMAIL + SMOKE_PASSWORD (seeded coach) also check sign-in; supply
 * them from the environment only, never commit them.
 */
const stagingUrl = process.env.STAGING_URL;
test.skip(!stagingUrl, 'STAGING_URL is not set');

test('web /healthz responds 200', async ({ request }) => {
  const res = await request.get(new URL('/healthz', stagingUrl).toString());
  expect(res.status()).toBe(200);
});

test('login page renders', async ({ page }) => {
  await page.goto(new URL('/login', stagingUrl).toString());
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('seeded coach can sign in', async ({ page }) => {
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  test.skip(!email || !password, 'SMOKE_EMAIL / SMOKE_PASSWORD are not set');
  await page.goto(new URL('/login', stagingUrl).toString());
  await page.getByLabel('Email').fill(email ?? '');
  await page.getByLabel('Password').fill(password ?? '');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/app/);
});
