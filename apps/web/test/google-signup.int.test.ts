import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { TEST_SECRET } from './harness/tenants';

const ORIGIN = 'http://localhost:3000';
const env = {
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: TEST_SECRET,
  DISABLE_BREACHED_PASSWORD_CHECK: 'true',
  GOOGLE_CLIENT_ID: 'test-client',
  GOOGLE_CLIENT_SECRET: 'test-secret',
};

let prisma: PrismaClient;
let authPrisma: PrismaClient;
let drop: () => Promise<void>;
let auth: Auth;
let visitor = 0;

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const idToken = (email: string, sub: string) =>
  `${b64({ alg: 'none' })}.${b64({
    iss: 'https://accounts.google.com',
    aud: 'test-client',
    sub,
    email,
    email_verified: true,
    name: 'New Coach',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.x`;

/** Runs Better Auth's real sign-in and callback routes; only Google's token endpoint is replaced. */
async function googleFlow(body: Record<string, unknown>, email: string, sub: string) {
  const start = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        // Each flow is its own visitor, so the sign-in rate limit does not trip.
        'cf-connecting-ip': `203.0.113.${++visitor}`,
      },
      body: JSON.stringify({ provider: 'google', callbackURL: '/app', ...body }),
    }),
  );
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get('state') as string;
  const cookie = start.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const real = globalThis.fetch;
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const target = input instanceof Request ? input.url : String(input);
    if (target.startsWith('https://oauth2.googleapis.com/token')) {
      return Promise.resolve(
        Response.json({
          access_token: 'a',
          id_token: idToken(email, sub),
          expires_in: 3600,
          token_type: 'Bearer',
        }),
      );
    }
    return real(input, init);
  });
  try {
    const res = await auth.handler(
      new Request(`${ORIGIN}/api/auth/callback/google?code=c&state=${state}`, {
        headers: { cookie },
      }),
    );
    return { status: res.status, location: res.headers.get('location') };
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('Google sign-up', () => {
  beforeAll(async () => {
    ({ prisma, authPrisma, drop } = await createTestDb());
    auth = createAuth({ prisma, authPrisma, env });
  }, 120_000);
  afterAll(async () => {
    await drop();
  });

  it('creates the account from the sign-up button and goes to onboarding', async () => {
    const r = await googleFlow(
      {
        requestSignUp: true,
        newUserCallbackURL: '/onboarding/pilot-code',
        errorCallbackURL: '/signup?google=failed',
      },
      'new-coach@example.com',
      'sub-1',
    );
    expect(r.location).toBe('/onboarding/pilot-code');
  });

  it('creates the account from the log-in button too', async () => {
    const r = await googleFlow(
      {
        requestSignUp: true,
        newUserCallbackURL: '/onboarding/pilot-code',
        errorCallbackURL: '/login?sso=google',
      },
      'login-coach@example.com',
      'sub-3',
    );
    expect(r.location).toBe('/onboarding/pilot-code');
  });

  it('signs an existing account in without onboarding', async () => {
    const r = await googleFlow(
      {
        requestSignUp: true,
        newUserCallbackURL: '/onboarding/pilot-code',
        errorCallbackURL: '/login?sso=google',
      },
      'login-coach@example.com',
      'sub-3',
    );
    expect(r.location).toBe('/app');
  });

  it('refuses a new email when the request does not ask for an account', async () => {
    const r = await googleFlow(
      { errorCallbackURL: '/login?sso=google' },
      'nobody@example.com',
      'sub-2',
    );
    expect(r.location).toContain('/login?sso=google');
    expect(r.location).toContain('error=signup_disabled');
  });
});
