import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIVACY_NOTICE_VERSION } from '@kinetic/core';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { acceptWithSignup } from '@/lib/accept-invite';
import { isProtectedPath } from '@/lib/guard';
import { createApiHandler } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { clientsPostRoute } from '@/server/routes/clients';
import { inviteAcceptRoute } from '@/server/routes/inviteAccept';
import { inviteDeleteRoute, invitePostRoute } from '@/server/routes/invites';
import { meRoute } from '@/server/routes/me';
import {
  createUser,
  headersFor,
  seedTwoTenants,
  TEST_PASSWORD,
  TEST_SECRET,
  type SeededUser,
  type TwoTenants,
} from './harness/tenants';

const ORIGIN = 'http://localhost:3000';
const env = {
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: TEST_SECRET,
  DISABLE_BREACHED_PASSWORD_CHECK: 'true',
};

let prisma: PrismaClient;
let authPrisma: PrismaClient;
let drop: () => Promise<void>;
let auth: Auth;
let t: TwoTenants;
let seq = 0;

const api = () =>
  createApiHandler({
    auth,
    prisma,
    secret: TEST_SECRET,
    appBaseUrl: ORIGIN,
    limiter: new InMemoryRateLimiter({ capacity: 1000, refillPerSecond: 1000 }),
  });

const mutating = (headers: Headers, body?: unknown) => {
  const h = new Headers(headers);
  h.set('origin', ORIGIN);
  h.set('content-type', 'application/json');
  return {
    method: 'POST',
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Coach creates a client with `email` and issues an invite; returns the plaintext token. */
async function issueFor(coach: SeededUser, orgId: string, email: string) {
  const created = await api()(clientsPostRoute)(
    new Request(
      `${ORIGIN}/api/v1/clients`,
      mutating(headersFor(coach, orgId), { name: 'Ann', email }),
    ),
  );
  const clientId = ((await created.json()) as { data: { id: string } }).data.id;
  const res = await api()(invitePostRoute)(
    new Request(`${ORIGIN}/api/v1/clients/${clientId}/invite`, mutating(headersFor(coach, orgId))),
    ctx(clientId),
  );
  const { inviteId } = ((await res.json()) as { data: { inviteId: string } }).data;
  const mail = await withSystem(
    (tx) =>
      tx.outboxEmail.findUniqueOrThrow({ where: { idempotencyKey: `client_invite:${inviteId}` } }),
    prisma,
  );
  const token = (mail.payloadJson as { token: string }).token;
  return { token, clientId, inviteId, orgId };
}

const freshEmail = () => `invitee${(seq += 1)}-${crypto.randomUUID().slice(0, 6)}@example.test`;
const ip = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${(seq += 1) % 250}`;
const deps = () => ({ auth, prisma, headers: new Headers({ 'x-forwarded-for': ip() }) });
const onboarding = {
  consent: true,
  timezone: 'Europe/Paris',
  preferredUnits: 'lb' as const,
  goals: 'Run a 10k',
};

const acceptVia = (user: SeededUser, token: string, body: Record<string, unknown> = {}) =>
  api()(inviteAcceptRoute)(
    new Request(
      `${ORIGIN}/api/v1/auth/invite/accept`,
      mutating(headersFor(user), { token, ...onboarding, ...body }),
    ),
  );

const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('invite acceptance', () => {
  it('signed-out accept creates verified user, client membership, links client, sets consent', async () => {
    const email = freshEmail();
    const { token, clientId, orgId } = await issueFor(t.coachA, t.orgA.id, email);
    const result = await acceptWithSignup(deps(), {
      token,
      password: TEST_PASSWORD,
      ...onboarding,
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('unreachable');
    expect(result.setCookies.join(';')).toContain('session_token');

    const user = await withSystem((tx) => tx.user.findUniqueOrThrow({ where: { email } }), prisma);
    expect(user.emailVerified).toBe(true);
    const memberships = await withSystem(
      (tx) => tx.membership.findMany({ where: { userId: user.id } }),
      prisma,
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      organizationId: orgId,
      role: 'client',
      status: 'active',
    });
    const client = await withSystem(
      (tx) => tx.client.findUniqueOrThrow({ where: { id: clientId } }),
      prisma,
    );
    expect(client).toMatchObject({
      userId: user.id,
      status: 'active',
      consentVersion: PRIVACY_NOTICE_VERSION,
      timezone: 'Europe/Paris',
      preferredUnits: 'lb',
      goals: 'Run a 10k',
    });
    expect(client.consentAt).toBeInstanceOf(Date);
    // No stray verification email for a mailbox the invite already proved.
    const pending = await withSystem(
      (tx) => tx.outboxEmail.count({ where: { toUserId: user.id, status: 'pending' } }),
      prisma,
    );
    expect(pending).toBe(0);
  });

  it('rejects bad fields without creating a user', async () => {
    const email = freshEmail();
    const { token } = await issueFor(t.coachA, t.orgA.id, email);
    const short = await acceptWithSignup(deps(), { token, password: 'short', ...onboarding });
    expect(short).toMatchObject({ ok: false, fieldErrors: { password: expect.any(String) } });
    const noConsent = await acceptWithSignup(deps(), {
      token,
      password: TEST_PASSWORD,
      ...onboarding,
      consent: false,
    });
    expect(noConsent).toMatchObject({ ok: false, fieldErrors: { consent: expect.any(String) } });
    const badTz = await acceptWithSignup(deps(), {
      token,
      password: TEST_PASSWORD,
      ...onboarding,
      timezone: 'Nope/Zone',
    });
    expect(badTz).toMatchObject({ ok: false, fieldErrors: { timezone: expect.any(String) } });
    expect(await withSystem((tx) => tx.user.count({ where: { email } }), prisma)).toBe(0);
  });

  it('an email that already has an account is told to sign in', async () => {
    const { token } = await issueFor(t.coachA, t.orgA.id, t.clientA.email);
    const result = await acceptWithSignup(deps(), {
      token,
      password: TEST_PASSWORD,
      ...onboarding,
    });
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { form: expect.stringMatching(/sign in/i) },
    });
  });

  it('existing owner becomes client of another org (same user, both memberships)', async () => {
    const { token, orgId } = await issueFor(t.coachB, t.orgB.id, t.coachA.email);
    const res = await acceptVia(t.coachA, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { orgId: string; clientId: string } };
    expect(body.data.orgId).toBe(orgId);
    expect(res.headers.get('set-cookie')).toMatch(/^kinetic_org=/);

    const users = await withSystem(
      (tx) => tx.user.findMany({ where: { email: t.coachA.email } }),
      prisma,
    );
    expect(users).toHaveLength(1);
    expect(users[0]?.id).toBe(t.coachA.id);

    const me = await api()(meRoute)(
      new Request(`${ORIGIN}/api/v1/me`, { headers: headersFor(t.coachA) }),
    );
    const { memberships } = (
      (await me.json()) as { data: { memberships: { orgId: string; role: string }[] } }
    ).data;
    expect(memberships).toEqual(
      expect.arrayContaining([
        { orgId: t.orgA.id, role: 'owner' },
        { orgId: t.orgB.id, role: 'client' },
      ]),
    );
  });

  it('email mismatch rejected (case-insensitive match accepted)', async () => {
    const { token } = await issueFor(t.coachB, t.orgB.id, freshEmail());
    const res = await acceptVia(t.clientA, token);
    expect(res.status).toBe(403);

    const upper = await createUser(prisma, auth, 'mixedcase');
    const { token: t2 } = await issueFor(t.coachB, t.orgB.id, upper.email.toUpperCase());
    expect((await acceptVia(upper, t2)).status).toBe(200);
  });

  it('expired/used/revoked/unknown tokens -> 410/410/410/404 codes', async () => {
    const user = await createUser(prisma, auth, 'late');
    const expired = await issueFor(t.coachB, t.orgB.id, user.email);
    await withSystem(
      (tx) =>
        tx.clientInvite.update({
          where: { id: expired.inviteId },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
      prisma,
    );
    const res = await acceptVia(user, expired.token);
    expect([res.status, await errorOf(res)]).toEqual([410, 'INVITE_EXPIRED']);

    const u2 = await createUser(prisma, auth, 'once');
    const used = await issueFor(t.coachB, t.orgB.id, u2.email);
    expect((await acceptVia(u2, used.token)).status).toBe(200);
    const again = await acceptVia(u2, used.token);
    expect([again.status, await errorOf(again)]).toEqual([410, 'INVITE_USED']);

    const u3 = await createUser(prisma, auth, 'revoked');
    const revoked = await issueFor(t.coachB, t.orgB.id, u3.email);
    await api()(inviteDeleteRoute)(
      new Request(`${ORIGIN}/api/v1/clients/${revoked.clientId}/invite`, {
        ...mutating(headersFor(t.coachB, t.orgB.id)),
        method: 'DELETE',
      }),
      ctx(revoked.clientId),
    );
    const rev = await acceptVia(u3, revoked.token);
    expect([rev.status, await errorOf(rev)]).toEqual([410, 'INVITE_REVOKED']);

    const unknown = await acceptVia(u3, 'x'.repeat(43));
    expect([unknown.status, await errorOf(unknown)]).toEqual([404, 'INVITE_INVALID']);
  });

  it('missing consent -> 422', async () => {
    const u = await createUser(prisma, auth, 'noconsent');
    const { token } = await issueFor(t.coachB, t.orgB.id, u.email);
    expect((await acceptVia(u, token, { consent: false })).status).toBe(422);
  });

  it('6th attempt in 15 min -> RATE_LIMITED (signed-out, per token hash)', async () => {
    const token = 'r'.repeat(43);
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 6; i += 1) {
      const r = await acceptWithSignup(deps(), { token, password: TEST_PASSWORD, ...onboarding });
      codes.push(r.ok ? undefined : r.code);
    }
    expect(codes).toEqual([
      'INVITE_INVALID',
      'INVITE_INVALID',
      'INVITE_INVALID',
      'INVITE_INVALID',
      'INVITE_INVALID',
      'RATE_LIMITED',
    ]);
  });

  it('6th signed-in attempt -> 429 RATE_LIMITED', async () => {
    const u = await createUser(prisma, auth, 'spammy');
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await acceptVia(u, 'q'.repeat(43))).status);
    expect(statuses).toEqual([404, 404, 404, 404, 404, 429]);
  });

  it('/invite/* is public (not behind the proxy)', () => {
    expect(isProtectedPath('/invite/abc')).toBe(false);
  });
});
