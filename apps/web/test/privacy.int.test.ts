import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler, type RouteDef } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import {
  adminAccountLookupRoute,
  adminDeletionPatchRoute,
  adminDeletionsListRoute,
  adminGrantPostRoute,
  adminPilotCodesPostRoute,
  adminSupportClientRoute,
  deletionRequestPostRoute,
} from '@/server/routes/privacy';
import {
  createUser,
  headersFor,
  seedTwoTenants,
  TEST_SECRET,
  type SeededUser,
  type TwoTenants,
} from './harness/tenants';
import { linkClient } from './harness/sessions';

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
let admin: SeededUser;
let clientA: string;

const api = () =>
  createApiHandler({
    auth,
    prisma,
    secret: TEST_SECRET,
    appBaseUrl: ORIGIN,
    limiter: new InMemoryRateLimiter({ capacity: 1000, refillPerSecond: 1000 }),
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRoute = RouteDef<any, any>;
const call = (
  route: AnyRoute,
  headers: Headers,
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  body?: unknown,
  id = '',
) => {
  const h = new Headers(headers);
  if (method !== 'GET') h.set('origin', ORIGIN);
  if (body !== undefined) h.set('content-type', 'application/json');
  return api()(route)(
    new Request(`${ORIGIN}/api/v1${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
};

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
  clientA = await linkClient(prisma, t.orgA.id, t.clientA.id, t.coachA.id);
  admin = await createUser(prisma, auth, 'admin');
  await withSystem(
    (tx) => tx.user.update({ where: { id: admin.id }, data: { isPlatformAdmin: true } }),
    prisma,
  );
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('deletion requests and the admin API (S5-3)', () => {
  it('a client requests deletion; the admin sees and verifies it', async () => {
    const res = await call(
      deletionRequestPostRoute,
      headersFor(t.clientA, t.orgA.id),
      '/deletion-requests',
      'POST',
      {},
    );
    expect(res.status).toBe(202);
    const req = (await res.json()).data;
    expect(req).toMatchObject({ clientId: clientA, status: 'requested', requestedByClient: true });
    const asAdmin = headersFor(admin);
    const queue = (
      await (await call(adminDeletionsListRoute, asAdmin, '/admin/deletions', 'GET')).json()
    ).data;
    expect(queue[0]).toMatchObject({ id: req.id, status: 'requested' });
    expect(
      (
        await call(
          adminDeletionPatchRoute,
          asAdmin,
          `/admin/deletions/${req.id}`,
          'PATCH',
          { action: 'verify' },
          req.id,
        )
      ).status,
    ).toBe(204);
    // A second verify of a verified request is fine; rejecting a processing one is not reachable here.
    const row = await withSystem(
      (tx) => tx.deletionRequest.findUniqueOrThrow({ where: { id: req.id } }),
      prisma,
    );
    expect(row.status).toBe('verified');
  });

  it('non-admin → 404 on every admin route; admin reading client data without a grant → 403', async () => {
    const coach = headersFor(t.coachA, t.orgA.id);
    for (const [route, path, method, body] of [
      [adminDeletionsListRoute, '/admin/deletions', 'GET'],
      [adminPilotCodesPostRoute, '/admin/pilot-codes', 'POST', {}],
      [
        adminAccountLookupRoute,
        `/admin/accounts?email=${encodeURIComponent(t.clientA.email)}`,
        'GET',
      ],
      [adminSupportClientRoute, `/admin/support/clients/${clientA}`, 'GET'],
    ] as const) {
      expect((await call(route, coach, path, method, body, clientA)).status).toBe(404);
    }
    const asAdmin = headersFor(admin);
    expect(
      (
        await call(
          adminSupportClientRoute,
          asAdmin,
          `/admin/support/clients/${clientA}`,
          'GET',
          undefined,
          clientA,
        )
      ).status,
    ).toBe(403);
    const grant = await call(adminGrantPostRoute, asAdmin, '/admin/support-grants', 'POST', {
      clientId: clientA,
      reason: 'Ticket 7',
    });
    expect(grant.status).toBe(201);
    const read = await call(
      adminSupportClientRoute,
      asAdmin,
      `/admin/support/clients/${clientA}`,
      'GET',
      undefined,
      clientA,
    );
    expect(read.status).toBe(200);
    const account = await (
      await call(
        adminAccountLookupRoute,
        asAdmin,
        `/admin/accounts?email=${encodeURIComponent(t.clientA.email)}`,
        'GET',
      )
    ).json();
    expect(account.data.memberships.map((m: { role: string }) => m.role)).toContain('client');
    const code = await call(adminPilotCodesPostRoute, asAdmin, '/admin/pilot-codes', 'POST', {
      days: 7,
    });
    expect(code.status).toBe(201);
    expect((await code.json()).data.code).toBeTruthy();
  });

  it('only a client or an owner can request deletion', async () => {
    const coach = await createUser(prisma, auth, 'staffcoach');
    await withSystem(
      (tx) =>
        tx.membership.create({
          data: { userId: coach.id, organizationId: t.orgA.id, role: 'coach' },
        }),
      prisma,
    );
    expect(
      (
        await call(
          deletionRequestPostRoute,
          headersFor(coach, t.orgA.id),
          '/deletion-requests',
          'POST',
          { clientId: clientA },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          deletionRequestPostRoute,
          headersFor(t.coachB, t.orgB.id),
          '/deletion-requests',
          'POST',
          { clientId: clientA },
        )
      ).status,
    ).toBe(404);
  });
});
