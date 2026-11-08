/**
 * E2E user helpers (stand-in until the seed lands in Task 0.7).
 *
 * - `signUpVerifiedCoach`: drives the real UI sign-up with a fresh pilot code,
 *   reads the verification email from the dev email sink and follows the link.
 *   Result: a verified coach with an organization + owner membership, signed in
 *   on the given page.
 * Sign-up is rate limited per IP, so each helper clears the attempt counters first.
 * - `signUpVerifiedClient`: signs up a second user the same way (sign-up is
 *   pilot-code gated), then via the admin DB connection gives them a `client`
 *   membership in the coach's organization and removes their own owner
 *   membership. Result: a verified user whose only role is `client`, signed in
 *   on the given page (use a separate browser context from the coach).
 */
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { grantPilotAccess, makeClientOfCoach, resetRateLimits } from '../support/db';

export const E2E_PASSWORD = 'e2e-correct-horse-battery';

export interface E2EUser {
  email: string;
  name: string;
  password: string;
  orgName: string;
}

interface SunkEmail {
  to: string;
  templateKey: string;
  text: string;
}

export async function waitForEmail(
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

let counter = 0;
// Workers are separate processes with their own counter: the random part keeps ids (and the
// pilot codes derived from them) from colliding when two workers sign up in the same millisecond.
const unique = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${counter++}`;

async function signUpAndVerify(
  page: Page,
  request: APIRequestContext,
  prefix: string,
  displayName: string,
): Promise<E2EUser> {
  const id = unique(prefix);
  const user: E2EUser = {
    email: `${id}@example.test`,
    name: displayName,
    password: E2E_PASSWORD,
    orgName: `${displayName} Org`,
  };
  // Sign-up is rate limited per IP and parallel workers share one IP, so another
  // worker can refill the counter between our reset and submit: retry.
  await expect(async () => {
    await resetRateLimits();
    await page.goto('/signup');
    await page.getByLabel('Your name').fill(user.name);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByLabel('Business name').fill(user.orgName);
    await page.getByLabel('Time zone').selectOption('Europe/London');
    await page.getByRole('button', { name: 'Create account' }).click();
    // Generous: a slow (not failed) sign-up must not be retried, or its email is already taken.
    await expect(page).toHaveURL(/\/verify-email$/, { timeout: 20_000 });
  }).toPass({ timeout: 90_000 });
  await grantPilotAccess(user.email);

  const mail = await waitForEmail(request, user.email, 'auth.verify_email');
  const link = /https?:\/\/\S+/.exec(mail.text)?.[0];
  expect(link).toBeTruthy();
  await page.goto(link as string);
  await expect(page).toHaveURL(/\/app$/);
  return user;
}

export function signUpVerifiedCoach(page: Page, request: APIRequestContext): Promise<E2EUser> {
  return signUpAndVerify(page, request, 'c', 'Casey Coach');
}

export async function signUpVerifiedClient(
  page: Page,
  request: APIRequestContext,
  coach: E2EUser,
): Promise<E2EUser> {
  const user = await signUpAndVerify(page, request, 'u', 'Chris Client');
  await makeClientOfCoach(coach.email, user.email);
  return user;
}

/** Signs in through the login form and waits to land on `landing` (/app for coaches, /portal for clients). */
export async function signIn(page: Page, email: string, landing: RegExp): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(landing, { timeout: 30_000 });
}
