import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { meRoute } from '@/server/routes/me';
import { orgGetRoute, orgPatchRoute } from '@/server/routes/org';
import { seedTwoTenants, headersFor, TEST_SECRET, type TwoTenants } from './harness/tenants';

const ORIGIN = 'http://localhost:3000';
const env = {
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: TEST_SECRET,
  DISABLE_BREACHED_PASSWORD_CHECK: 'true',
};

let prisma: PrismaClient;
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

const get = (headers: Headers) =>
  api()(orgGetRoute)(new Request(`${ORIGIN}/api/v1/org`, { headers }));

const patch = (headers: Headers, body: unknown) => {
  const h = new Headers(headers);
  h.set('origin', ORIGIN);
  h.set('content-type', 'application/json');
  return api()(orgPatchRoute)(
    new Request(`${ORIGIN}/api/v1/org`, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify(body),
    }),
  );
};

const orgName = async (id: string) =>
  (await withSystem((tx) => tx.organization.findUniqueOrThrow({ where: { id } }), prisma)).name;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  auth = createAuth({ prisma, env });
  t = await seedTwoTenants(prisma, auth);
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('cross-tenant isolation', () => {
  it('coach B reading org A resource → 404 (no existence leak)', async () => {
    const res = await get(headersFor(t.coachB, t.orgA.id));
    expect(res.status).toBe(404);
    const unknown = await get(headersFor(t.coachB, crypto.randomUUID()));
    expect(unknown.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(await unknown.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('coach reads own org', async () => {
    const res = await get(headersFor(t.coachA));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: { id: t.orgA.id, name: 'Org A', timezone: 'UTC' },
    });
  });

  it('client role on coach route → 403', async () => {
    expect((await get(headersFor(t.clientA))).status).toBe(403);
    expect((await patch(headersFor(t.clientA), { name: 'Hacked' })).status).toBe(403);
    expect(await orgName(t.orgA.id)).toBe('Org A');
  });

  it('dualRoleUser as client of B cannot read org A data via B context', async () => {
    const res = await get(headersFor(t.dualRoleUser, t.orgB.id));
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain('Org A');
    // acting in A, where they are owner, works
    expect((await get(headersFor(t.dualRoleUser, t.orgA.id))).status).toBe(200);
  });

  it('organizationId in request body is ignored', async () => {
    const res = await patch(headersFor(t.coachB), { name: 'B renamed', organizationId: t.orgA.id });
    expect(res.status).toBe(200);
    expect(await orgName(t.orgA.id)).toBe('Org A');
    expect(await orgName(t.orgB.id)).toBe('B renamed');
  });

  it('coach B cannot PATCH org A via cookie', async () => {
    const res = await patch(headersFor(t.coachB, t.orgA.id), { name: 'Pwned' });
    expect(res.status).toBe(404);
    expect(await orgName(t.orgA.id)).toBe('Org A');
  });

  it('GET /me lists memberships without needing an active org', async () => {
    const res = await api()(meRoute)(
      new Request(`${ORIGIN}/api/v1/me`, { headers: headersFor(t.dualRoleUser) }),
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { userId: string; memberships: { orgId: string; role: string }[] };
    };
    expect(data.userId).toBe(t.dualRoleUser.id);
    expect(data.memberships).toHaveLength(2);
    expect(data.memberships).toContainEqual({ orgId: t.orgB.id, role: 'client' });
  });
});
