import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { hashPilotCode } from '@kinetic/core';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createAuthHandlers } from '@/lib/auth-handler';
import { guardRequest } from '@/lib/guard';
import { redeemPilotCode, registerCoach } from '@/lib/register-coach';

const ORIGIN = 'http://localhost:3000';
const env = {
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-1',
  DISABLE_BREACHED_PASSWORD_CHECK: 'true',
};
const PASSWORD = 'correct-horse-battery';

let prisma: PrismaClient;
/** Better Auth's client: sees every users row (test assertions on users go through it). */
let authPrisma: PrismaClient;
let drop: () => Promise<void>;
let auth: Auth;
let deps: { auth: Auth; prisma: PrismaClient };
let adminId: string;

const ip = (n: number) => new Headers({ 'x-forwarded-for': `10.1.0.${n}` });

const post = (path: string, body: unknown) =>
  createAuthHandlers(auth).POST(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify(body),
    }),
  );

const seedCode = (code: string) =>
  withSystem(
    (tx) =>
      tx.pilotCode.create({
        data: {
          codeHash: hashPilotCode(code),
          createdBy: adminId,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
    prisma,
  );

const input = (email: string, pilotCode: string) => ({
  name: 'New Coach',
  email,
  password: PASSWORD,
  orgName: 'Org',
  timezone: 'UTC',
  pilotCode,
});

const count = (email: string) => authPrisma.user.count({ where: { email } });
const outbox = () => withSystem((tx) => tx.outboxEmail.count(), prisma);

/** Verified user with a live session cookie, but no membership. */
async function verifiedOrphan(email: string) {
  await auth.api.signUpEmail({ body: { name: 'Orphan', email, password: PASSWORD } });
  await authPrisma.user.update({ where: { email }, data: { emailVerified: true } });
  const res = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  const user = await authPrisma.user.findUniqueOrThrow({ where: { email } });
  return { cookie, user };
}

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  deps = { auth, prisma };
  adminId = (await authPrisma.user.create({ data: { email: 'admin@example.test', name: 'A' } })).id;
});

afterAll(async () => {
  await drop();
});

describe('pilot-code gate', () => {
  it('HTTP sign-up is rejected: no user created, no email enqueued', async () => {
    const before = await outbox();
    const res = await post('/sign-up/email', {
      name: 'Sneaky',
      email: 'sneaky@example.test',
      password: PASSWORD,
    });
    expect(res.status).toBe(403);
    expect(await count('sneaky@example.test')).toBe(0);
    expect(await outbox()).toBe(before);
  });

  it('HTTP social sign-in cannot request an implicit sign-up', async () => {
    const res = await post('/sign-in/social', {
      provider: 'google',
      requestSignUp: true,
      callbackURL: '/app',
    });
    expect(res.status).toBe(403);
  });

  it('google provider disables implicit sign-up and is absent when unconfigured', () => {
    const google = createAuth({
      prisma,
      authPrisma,
      env: { ...env, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' },
    });
    expect(google.options.socialProviders?.google?.disableImplicitSignUp).toBe(true);
    expect(auth.options.socialProviders).toBeUndefined();
  });

  it('server-side registration still works and creates org + owner membership', async () => {
    await seedCode('reg-ok');
    const registered = await registerCoach(
      { ...deps, headers: ip(1) },
      input('reg-ok@example.test', 'reg-ok'),
    );
    const user = await authPrisma.user.findUniqueOrThrow({
      where: { email: 'reg-ok@example.test' },
    });
    // The new account's id, for the coach_signed_up event (S5-4).
    expect(registered).toEqual({ ok: true, userId: user.id });
    const memberships = await withSystem(
      (tx) => tx.membership.findMany({ where: { userId: user.id } }),
      prisma,
    );
    expect(memberships).toMatchObject([{ role: 'owner' }]);
  });
});

describe('membership gate', () => {
  it('verified user without membership: /app redirects to /onboarding/pilot-code', async () => {
    const { cookie } = await verifiedOrphan('orphan@example.test');
    const res = await guardRequest(new NextRequest(`${ORIGIN}/app`, { headers: { cookie } }), deps);
    expect(res?.status).toBe(307);
    expect(new URL(res?.headers.get('location') ?? '').pathname).toBe('/onboarding/pilot-code');
    const onboarding = new NextRequest(`${ORIGIN}/onboarding/pilot-code`, { headers: { cookie } });
    expect(await guardRequest(onboarding, deps)).toBeNull();
  });

  it('redeeming a valid code creates org + owner membership and opens /app', async () => {
    const { cookie, user } = await verifiedOrphan('redeem@example.test');
    await seedCode('redeem-ok');
    const { orgId } = await redeemPilotCode(
      { ...deps, headers: ip(2), user },
      { pilotCode: 'redeem-ok', orgName: 'Redeemed Gym', timezone: 'UTC' },
    );
    const members = await withSystem(
      (tx) => tx.membership.findMany({ where: { organizationId: orgId } }),
      prisma,
    );
    expect(members).toMatchObject([{ userId: user.id, role: 'owner' }]);
    const open = await guardRequest(
      new NextRequest(`${ORIGIN}/app`, { headers: { cookie } }),
      deps,
    );
    expect(open).toBeNull();
  });

  it('a user who already has a workspace cannot redeem another code', async () => {
    const { user } = await verifiedOrphan('twice@example.test');
    await seedCode('twice-1');
    await seedCode('twice-2');
    const args = { orgName: 'Gym', timezone: 'UTC' };
    await redeemPilotCode({ ...deps, headers: ip(3), user }, { pilotCode: 'twice-1', ...args });
    await expect(
      redeemPilotCode({ ...deps, headers: ip(3), user }, { pilotCode: 'twice-2', ...args }),
    ).rejects.toMatchObject({ code: 'ALREADY_ONBOARDED' });
  });
});

describe('failed registration', () => {
  it('signupCoach failure deletes the new user, and a retry then succeeds', async () => {
    await seedCode('comp-code');
    const failing = registerCoach(
      { ...deps, headers: ip(4), redeem: () => Promise.reject(new Error('transient')) },
      input('comp@example.test', 'comp-code'),
    );
    await expect(failing).rejects.toThrow('transient');
    expect(await count('comp@example.test')).toBe(0);

    const retry = await registerCoach(
      { ...deps, headers: ip(4) },
      input('comp@example.test', 'comp-code'),
    );
    expect(retry).toMatchObject({ ok: true, userId: expect.any(String) });
    expect(await count('comp@example.test')).toBe(1);
  });

  it('rejects an 11-char password at registration without consuming the code', async () => {
    await seedCode('short-pw');
    const result = await registerCoach(
      { ...deps, headers: ip(8) },
      { ...input('shortpw@example.test', 'short-pw'), password: 'elevenchars' },
    );
    expect(result).toMatchObject({ ok: false, fieldErrors: { password: expect.any(String) } });
    expect(await count('shortpw@example.test')).toBe(0);
    const code = await prisma.pilotCode.findUniqueOrThrow({
      where: { codeHash: hashPilotCode('short-pw') },
    });
    expect(code.usedAt).toBeNull();
  });

  it('an unusable code is rejected before any user is created', async () => {
    const result = await registerCoach(
      { ...deps, headers: ip(5) },
      input('nocode@example.test', 'does-not-exist'),
    );
    expect(result).toMatchObject({ ok: false, fieldErrors: { pilotCode: expect.any(String) } });
    expect(await count('nocode@example.test')).toBe(0);
  });

  it('6th attempt within 15 minutes is RATE_LIMITED', async () => {
    for (let i = 0; i < 5; i += 1) {
      const r = await registerCoach(
        { ...deps, headers: ip(6) },
        input(`rl${i}@example.test`, 'bad-code'),
      );
      expect(r).toMatchObject({ ok: false, fieldErrors: { pilotCode: expect.any(String) } });
    }
    const sixth = await registerCoach(
      { ...deps, headers: ip(6) },
      input('rl6@example.test', 'bad-code'),
    );
    expect(sixth).toMatchObject({
      ok: false,
      fieldErrors: { form: expect.stringContaining('Too many') },
    });
  });

  it('pilot-code redemption is rate limited too', async () => {
    const { user } = await verifiedOrphan('brute@example.test');
    const args = { orgName: 'Gym', timezone: 'UTC' };
    for (let i = 0; i < 5; i += 1) {
      await expect(
        redeemPilotCode({ ...deps, headers: ip(7), user }, { pilotCode: `guess-${i}`, ...args }),
      ).rejects.toMatchObject({ code: 'PILOT_CODE_INVALID' });
    }
    await expect(
      redeemPilotCode({ ...deps, headers: ip(7), user }, { pilotCode: 'guess-6', ...args }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
