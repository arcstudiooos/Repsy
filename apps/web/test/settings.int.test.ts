import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { meRoute } from '@/server/routes/me';
import { sessionsRevokeAllRoute } from '@/server/routes/sessions';
import { settingsGetRoute, settingsPatchRoute } from '@/server/routes/settings';
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

const api = () =>
  createApiHandler({
    auth,
    prisma,
    secret: TEST_SECRET,
    appBaseUrl: ORIGIN,
    limiter: new InMemoryRateLimiter({ capacity: 1000, refillPerSecond: 1000 }),
  });

const mutating = (headers: Headers) => {
  const h = new Headers(headers);
  h.set('origin', ORIGIN);
  h.set('content-type', 'application/json');
  return h;
};

const getSettings = (headers: Headers) =>
  api()(settingsGetRoute)(new Request(`${ORIGIN}/api/v1/settings`, { headers }));
const patchSettings = (headers: Headers, body: unknown) =>
  api()(settingsPatchRoute)(
    new Request(`${ORIGIN}/api/v1/settings`, {
      method: 'PATCH',
      headers: mutating(headers),
      body: JSON.stringify(body),
    }),
  );
const me = (headers: Headers) => api()(meRoute)(new Request(`${ORIGIN}/api/v1/me`, { headers }));
const revokeAll = (headers: Headers) =>
  api()(sessionsRevokeAllRoute)(
    new Request(`${ORIGIN}/api/v1/sessions/revoke-all`, {
      method: 'POST',
      headers: mutating(headers),
    }),
  );

async function signIn(user: SeededUser): Promise<SeededUser> {
  const res = await auth.api.signInEmail({
    body: { email: user.email, password: TEST_PASSWORD },
    returnHeaders: true,
  });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return { ...user, cookie };
}

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('settings API', () => {
  it('owner GET returns profile, org with active count, and default-off notifications', async () => {
    const res = await getSettings(headersFor(t.coachA, t.orgA.id));
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data).toMatchObject({
      profile: { bio: null, specialties: [], units: 'kg' },
      org: { name: 'Org A', graceHours: 24, activeClientLimit: 30, activeClientCount: 0 },
      notifications: { messageEmailOptIn: false, marketingOptIn: false },
    });
    expect(data).not.toHaveProperty('client');
  });

  it('owner PATCH updates org and audits field names only', async () => {
    const res = await patchSettings(headersFor(t.coachA, t.orgA.id), {
      org: { name: 'Renamed', graceHours: 48 },
      organizationId: t.orgB.id,
    });
    expect(res.status).toBe(200);
    const orgs = await withSystem(
      (tx) => tx.organization.findMany({ select: { id: true, name: true, graceHours: true } }),
      prisma,
    );
    expect(orgs.find((o) => o.id === t.orgA.id)).toMatchObject({ name: 'Renamed', graceHours: 48 });
    expect(orgs.find((o) => o.id === t.orgB.id)).toMatchObject({ name: 'Org B', graceHours: 24 });
    const audit = await withSystem(
      (tx) =>
        tx.auditEvent.findFirstOrThrow({
          where: { action: 'settings.updated', organizationId: t.orgA.id },
        }),
      prisma,
    );
    expect(audit.metadataJson).toEqual({ fields: 'org.name,org.graceHours' });
    expect(JSON.stringify(audit)).not.toContain('Renamed');
  });

  it('blank graceHours (sent as null) → 422 on org.graceHours, nothing saved', async () => {
    const before = await withSystem(
      (tx) => tx.organization.findUniqueOrThrow({ where: { id: t.orgA.id } }),
      prisma,
    );
    const res = await patchSettings(headersFor(t.coachA, t.orgA.id), { org: { graceHours: null } });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { fieldErrors: Record<string, string[]> } };
    expect(body.error.fieldErrors['org.graceHours']?.[0]).toMatch(/whole number/);
    const after = await withSystem(
      (tx) => tx.organization.findUniqueOrThrow({ where: { id: t.orgA.id } }),
      prisma,
    );
    expect(after.graceHours).toBe(before.graceHours);
  });

  it('graceHours 73 → 422', async () => {
    const res = await patchSettings(headersFor(t.coachA, t.orgA.id), { org: { graceHours: 73 } });
    expect(res.status).toBe(422);
  });

  it("coach (non-owner) can't change org name (403)", async () => {
    const coach = await createUser(prisma, auth, 'coach-plain');
    await withSystem(
      (tx) =>
        tx.membership.create({
          data: { userId: coach.id, organizationId: t.orgA.id, role: 'coach' },
        }),
      prisma,
    );
    const res = await patchSettings(headersFor(coach, t.orgA.id), { org: { name: 'Nope' } });
    expect(res.status).toBe(403);
    const org = await withSystem(
      (tx) => tx.organization.findUniqueOrThrow({ where: { id: t.orgA.id } }),
      prisma,
    );
    expect(org.name).not.toBe('Nope');
    // They can still edit their own profile.
    const ok = await patchSettings(headersFor(coach, t.orgA.id), { profile: { bio: 'Hello' } });
    expect(ok.status).toBe(200);
  });

  it('client may patch only the client block and notifications', async () => {
    await withSystem(
      (tx) =>
        tx.client.create({
          data: {
            organizationId: t.orgA.id,
            userId: t.clientA.id,
            coachUserId: t.coachA.id,
            name: 'Client A',
            email: t.clientA.email,
            status: 'active',
            timezone: 'UTC',
          },
        }),
      prisma,
    );
    const h = headersFor(t.clientA, t.orgA.id);
    expect((await patchSettings(h, { org: { name: 'X' } })).status).toBe(403);
    expect((await patchSettings(h, { profile: { bio: 'X' } })).status).toBe(403);
    const ok = await patchSettings(h, {
      client: { preferredUnits: 'lb', timezone: 'Europe/Paris' },
      notifications: { marketingOptIn: true },
    });
    expect(ok.status).toBe(200);
    const { data } = (await ok.json()) as { data: Record<string, unknown> };
    expect(data).toMatchObject({
      client: { preferredUnits: 'lb', timezone: 'Europe/Paris' },
      notifications: { messageEmailOptIn: false, marketingOptIn: true },
      profile: null,
    });
  });

  it("a user's notification row is invisible to another user", async () => {
    // coachB's GET creates their own row only; coachA's marketing stays untouched.
    await getSettings(headersFor(t.coachB, t.orgB.id));
    const rows = await withSystem((tx) => tx.notificationPreference.findMany(), prisma);
    expect(new Set(rows.map((r) => r.userId)).size).toBe(rows.length);
  });
});

describe('POST /api/v1/sessions/revoke-all', () => {
  it("invalidates another session (that session's /me returns 401) and keeps the current one", async () => {
    const current = await signIn(t.dualRoleUser);
    const other = await signIn(t.dualRoleUser);
    expect((await me(headersFor(current))).status).toBe(200);
    expect((await me(headersFor(other))).status).toBe(200);

    const res = await revokeAll(headersFor(current, t.orgA.id));
    expect(res.status).toBe(200);

    expect((await me(headersFor(other))).status).toBe(401);
    expect((await me(headersFor(current))).status).toBe(200);
    const audit = await withSystem(
      (tx) =>
        tx.auditEvent.findFirst({
          where: { action: 'session.revoked_all', organizationId: t.orgA.id },
        }),
      prisma,
    );
    expect(audit).not.toBeNull();
  });

  it('works without an active org (multi-org user, no cookie) and writes no audit', async () => {
    const current = await signIn(t.dualRoleUser);
    const other = await signIn(t.dualRoleUser);
    const before = await withSystem(
      (tx) => tx.auditEvent.count({ where: { action: 'session.revoked_all' } }),
      prisma,
    );
    const res = await revokeAll(headersFor(current));
    expect(res.status).toBe(200);
    expect((await me(headersFor(other))).status).toBe(401);
    expect(
      await withSystem(
        (tx) => tx.auditEvent.count({ where: { action: 'session.revoked_all' } }),
        prisma,
      ),
    ).toBe(before);
  });

  it('401 without a session; 403 on cross-origin', async () => {
    expect((await revokeAll(new Headers())).status).toBe(401);
    const h = headersFor(t.coachB);
    const res = await api()(sessionsRevokeAllRoute)(
      new Request(`${ORIGIN}/api/v1/sessions/revoke-all`, {
        method: 'POST',
        headers: new Headers({ cookie: h.get('cookie') ?? '', origin: 'http://evil.test' }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
