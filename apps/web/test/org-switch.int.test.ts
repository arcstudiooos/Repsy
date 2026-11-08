import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { orgGetRoute } from '@/server/routes/org';
import { orgSwitchRoute } from '@/server/routes/orgSwitch';
import { headersFor, seedTwoTenants, TEST_SECRET, type TwoTenants } from './harness/tenants';

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

const switchTo = (headers: Headers, orgId: string) => {
  const h = new Headers(headers);
  h.set('origin', ORIGIN);
  h.set('content-type', 'application/json');
  return api()(orgSwitchRoute)(
    new Request(`${ORIGIN}/api/v1/org/switch`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ orgId }),
    }),
  );
};

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('org switch', () => {
  it('switching to a member org sets the cookie; the next /api/v1/org returns it', async () => {
    // dualRoleUser is owner of A and client of B: with two orgs and no cookie the org is ambiguous.
    const before = await api()(orgGetRoute)(
      new Request(`${ORIGIN}/api/v1/org`, { headers: headersFor(t.dualRoleUser) }),
    );
    expect(before.status).toBe(409);

    const res = await switchTo(headersFor(t.dualRoleUser), t.orgA.id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown }).data).toEqual({
      orgId: t.orgA.id,
      role: 'owner',
    });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^repsy_org=/);
    expect(setCookie).toMatch(/HttpOnly/);
    const orgCookie = (setCookie.split(';')[0] ?? '').trim();

    const after = await api()(orgGetRoute)(
      new Request(`${ORIGIN}/api/v1/org`, {
        headers: { cookie: `${t.dualRoleUser.cookie}; ${orgCookie}` },
      }),
    );
    expect(after.status).toBe(200);
    expect(((await after.json()) as { data: { id: string } }).data.id).toBe(t.orgA.id);
  });

  it('switching to a non-member org -> 404 and no cookie; bad id -> 422', async () => {
    const res = await switchTo(headersFor(t.coachA), t.orgB.id);
    expect(res.status).toBe(404);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect((await switchTo(headersFor(t.coachA), 'not-a-uuid')).status).toBe(422);
  });

  it('the actor for a client role has clientId set; owners do not', async () => {
    const client = await withSystem(
      (tx) =>
        tx.client.create({
          data: {
            organizationId: t.orgA.id,
            coachUserId: t.coachA.id,
            userId: t.clientA.id,
            name: 'Client A',
            email: t.clientA.email,
            status: 'active',
            timezone: 'UTC',
          },
        }),
      prisma,
    );
    const probe = api()({
      handler: ({ actor }) => ({ role: actor.role, clientId: actor.clientId ?? null }),
    });
    const asClient = await probe(
      new Request(`${ORIGIN}/api/v1/probe`, { headers: headersFor(t.clientA) }),
    );
    expect(((await asClient.json()) as { data: unknown }).data).toEqual({
      role: 'client',
      clientId: client.id,
    });
    const asOwner = await probe(
      new Request(`${ORIGIN}/api/v1/probe`, { headers: headersFor(t.coachA) }),
    );
    expect(((await asOwner.json()) as { data: unknown }).data).toEqual({
      role: 'owner',
      clientId: null,
    });
  });
});
