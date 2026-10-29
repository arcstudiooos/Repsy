import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { breachedPasswordCheckEnabled, createAuth, getSessionUser, type Auth } from '@/lib/auth';
import { createAuthHandlers } from '@/lib/auth-handler';
import { guardRequest } from '@/lib/guard';
import { createApiHandler } from '@/server/api';
import { meRoute } from '@/server/routes/me';

const ORIGIN = 'http://localhost:3000';
const env = {
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-1',
  DISABLE_BREACHED_PASSWORD_CHECK: 'true',
};
const PASSWORD = 'correct-horse-battery';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let auth: Auth;
let deps: { auth: Auth; prisma: PrismaClient };

const meApi = (headers: Headers) =>
  createApiHandler({ auth, prisma, secret: env.BETTER_AUTH_SECRET, appBaseUrl: ORIGIN })(meRoute)(
    new Request(`${ORIGIN}/api/v1/me`, { headers }),
  );

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  createAuthHandlers(auth).POST(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    }),
  );

async function createVerifiedUser(email: string): Promise<void> {
  await auth.api.signUpEmail({ body: { name: 'Test', email, password: PASSWORD } });
  await prisma.user.update({ where: { email }, data: { emailVerified: true } });
}

async function signIn(email: string): Promise<{ cookie: string; token: string }> {
  const res = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  const cookie = (res.headers.getSetCookie() ?? []).map((c) => c.split(';')[0]).join('; ');
  return { cookie, token: res.response.token };
}

/** Latest queued platform email of a kind, parsed for its link token. */
async function queuedLink(kind: string, userId: string): Promise<string> {
  let link = '';
  await vi.waitFor(async () => {
    const row = await withSystem(
      (tx) =>
        tx.outboxEmail.findFirst({
          where: { kind, toUserId: userId },
          orderBy: { createdAt: 'desc' },
        }),
      prisma,
    );
    expect(row).not.toBeNull();
    const text = (row?.payloadJson as { text: string }).text;
    link = /https?:\/\/\S+/.exec(text)?.[0] ?? '';
    expect(link).not.toBe('');
  });
  return link;
}

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  auth = createAuth({ prisma, env });
  deps = { auth, prisma };
});

afterAll(async () => {
  await drop();
});

describe('password policy', () => {
  it('rejects 11-char password with 422 over HTTP', async () => {
    const res = await post('/reset-password', { newPassword: 'elevenchars', token: 'whatever' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'PASSWORD_TOO_SHORT' });
  });

  it('registers the breached-password plugin unless explicitly disabled', () => {
    const ids = (e: Record<string, string>) =>
      createAuth({ prisma, env: e }).options.plugins?.map((p) => p.id) ?? [];
    expect(ids({ ...env, DISABLE_BREACHED_PASSWORD_CHECK: '' })).toContain('have-i-been-pwned');
    expect(ids({ ...env, DISABLE_BREACHED_PASSWORD_CHECK: 'false' })).toContain(
      'have-i-been-pwned',
    );
    expect(ids(env)).not.toContain('have-i-been-pwned');
    expect(breachedPasswordCheckEnabled({})).toBe(true);
  });
});

describe('route guard', () => {
  it('unverified user requesting /app is redirected to /verify-email', async () => {
    const email = 'unverified@example.test';
    await createVerifiedUser(email);
    const { cookie } = await signIn(email);
    await prisma.user.update({ where: { email }, data: { emailVerified: false } });

    const res = await guardRequest(new NextRequest(`${ORIGIN}/app`, { headers: { cookie } }), deps);
    expect(res?.status).toBe(307);
    expect(new URL(res?.headers.get('location') ?? '').pathname).toBe('/verify-email');
  });

  it('anonymous user is sent to /login, verified user passes, non-admin is blocked from /admin', async () => {
    const anon = await guardRequest(new NextRequest(`${ORIGIN}/settings`), deps);
    const loc = new URL(anon?.headers.get('location') ?? '');
    expect([loc.pathname, loc.searchParams.get('next')]).toEqual(['/login', '/settings']);

    await createVerifiedUser('ok@example.test');
    const ok = await prisma.user.findUniqueOrThrow({ where: { email: 'ok@example.test' } });
    await withSystem(async (tx) => {
      const org = await tx.organization.create({
        data: { name: 'Seeded', timezone: 'UTC', ownerUserId: ok.id },
      });
      await tx.membership.create({
        data: { userId: ok.id, organizationId: org.id, role: 'owner' },
      });
    }, prisma);
    const { cookie } = await signIn('ok@example.test');
    const headers = { cookie };
    expect(await guardRequest(new NextRequest(`${ORIGIN}/app`, { headers }), deps)).toBeNull();
    const admin = await guardRequest(new NextRequest(`${ORIGIN}/admin`, { headers }), deps);
    expect(admin?.status).toBe(403);
  });
});

describe('sessions', () => {
  it('revoked session returns 401', async () => {
    await createVerifiedUser('revoke@example.test');
    const { cookie, token } = await signIn('revoke@example.test');
    const headers = new Headers({ cookie });

    expect((await meApi(headers)).status).toBe(200);
    expect(await getSessionUser(headers, auth)).toMatchObject({
      email: 'revoke@example.test',
      emailVerified: true,
      isPlatformAdmin: false,
    });

    await auth.api.revokeSession({ body: { token }, headers });

    const after = await meApi(headers);
    expect(after.status).toBe(401);
    expect(await after.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });
});

describe('password reset', () => {
  it('reset token cannot be reused', async () => {
    const email = 'reset@example.test';
    await createVerifiedUser(email);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } });
    const link = await queuedLink('auth.reset_password', user.id);
    const token = (link.split('?')[0] ?? '').split('/').pop() as string;

    await auth.api.resetPassword({ body: { newPassword: 'a-brand-new-passphrase', token } });
    await expect(
      auth.api.resetPassword({ body: { newPassword: 'another-new-passphrase', token } }),
    ).rejects.toMatchObject({ status: 'BAD_REQUEST' });

    // Old password no longer works; the new one does.
    await expect(
      auth.api.signInEmail({ body: { email, password: PASSWORD } }),
    ).rejects.toBeDefined();
    await expect(
      auth.api.signInEmail({ body: { email, password: 'a-brand-new-passphrase' } }),
    ).resolves.toBeDefined();
  });
});
