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
import { createPilotCode, makeClientOfCoach, resetRateLimits } from '../support/db';

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

let counter = 0;
// Keep ids short: the dev email sink embeds the (email-derived) token in the file name,
// and long names exceed MAX_PATH on Windows.
const unique = (prefix: string) => `${prefix}${Date.now().toString(36)}${counter++}`;

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
  const code = `PILOT-${id}`;
  await resetRateLimits();
  await createPilotCode(code);

  await page.goto('/signup');
  await page.getByLabel('Your name').fill(user.name);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByLabel('Business name').fill(user.orgName);
  await page.getByLabel('Time zone').fill('Europe/London');
  await page.getByLabel('Pilot code').fill(code);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/verify-email$/);

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
