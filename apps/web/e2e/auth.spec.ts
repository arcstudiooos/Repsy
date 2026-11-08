import { expect, test, type APIRequestContext } from '@playwright/test';
import { findOwnerOrg, resetRateLimits } from './support/db';

const PASSWORD = 'e2e-correct-horse-battery';

interface SunkEmail {
  to: string;
  templateKey: string;
  text: string;
}

async function waitForEmail(
  request: APIRequestContext,
  to: string,
  templateKey: string,
): Promise<SunkEmail> {
  let found: SunkEmail | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get('/api/dev/emails');
        const { data } = (await res.json()) as { data: SunkEmail[] };
        found = data.find((e) => e.to === to && e.templateKey === templateKey);
        return found !== undefined;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return found as SunkEmail;
}

test('coach signs up, verifies, lands on /app', async ({ page, request }) => {
  const stamp = Date.now();
  const email = `coach-${stamp}@example.test`;

  // Sign-up is rate limited per IP and parallel workers share one IP: reset and retry.
  await expect(async () => {
    await resetRateLimits();
    await page.goto('/signup');
    await page.getByLabel('Your name').fill('Casey Coach');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByLabel('Business name').fill('Casey Strength');
    await page.getByLabel('Time zone').selectOption('Europe/London');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/verify-email$/, { timeout: 5_000 });
  }).toPass({ timeout: 45_000 });

  // Unverified: /app is closed.
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login\?next=%2Fapp$/);

  const mail = await waitForEmail(request, email, 'auth.verify_email');
  const link = /https?:\/\/\S+/.exec(mail.text)?.[0];
  expect(link).toBeTruthy();
  await page.goto(link as string);

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('heading', { name: 'Coach dashboard' })).toBeVisible();
  expect(await findOwnerOrg(email)).toEqual({ name: 'Casey Strength', role: 'owner' });
});

test('public sign-up endpoint is closed', async ({ request, baseURL }) => {
  const res = await request.post('/api/auth/sign-up/email', {
    headers: { origin: baseURL as string },
    data: { name: 'Bypass', email: `bypass-${Date.now()}@example.test`, password: PASSWORD },
  });
  expect(res.status()).toBe(403);
});
