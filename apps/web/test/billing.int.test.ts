import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler, type RouteDef } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import {
  billingConnectFakeRoute,
  billingSettingsGetRoute,
  billingSettingsPutRoute,
  manualPaymentRoute,
  packagesPostRoute,
  paymentsGetRoute,
  purchasesGetRoute,
  receiptGetRoute,
  signConnectState,
  verifyConnectState,
} from '@/server/routes/billing';
import {
  createUser,
  headersFor,
  seedTwoTenants,
  TEST_SECRET,
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
let clientAId: string;

const api = () =>
  createApiHandler({
    auth,
    prisma,
    secret: TEST_SECRET,
    appBaseUrl: ORIGIN,
    limiter: new InMemoryRateLimiter({ capacity: 1000, refillPerSecond: 1000 }),
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRoute = RouteDef<any, true>;
const call = (
  route: AnyRoute,
  headers: Headers,
  path: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: unknown,
  params: Record<string, string> = {},
) => {
  const h = new Headers(headers);
  if (method !== 'GET') {
    h.set('origin', ORIGIN);
    h.set('content-type', 'application/json');
  }
  return api()(route)(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: h,
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    }),
    { params: Promise.resolve(params) },
  );
};

beforeAll(async () => {
  process.env.ORG_COOKIE_SECRET = TEST_SECRET;
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
  clientAId = (
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
    )
  ).id;
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('billing API (PRD K1-K6, K15)', () => {
  it('a manager sets up payments; a coach and a client cannot', async () => {
    const owner = headersFor(t.coachA, t.orgA.id);
    expect(
      (
        await call(billingSettingsPutRoute, owner, '/api/v1/billing/settings', 'PUT', {
          currency: 'USD',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          billingConnectFakeRoute,
          owner,
          '/api/v1/billing/connect/fake',
          'POST',
          {},
          { provider: 'fake' },
        )
      ).status,
    ).toBe(204);
    const settings = (await (
      await call(billingSettingsGetRoute, owner, '/api/v1/billing/settings')
    ).json()) as {
      data: { currency: string; account: { provider: string } | null; providers: string[] };
    };
    expect(settings.data).toMatchObject({ currency: 'USD', account: { provider: 'fake' } });
    expect(settings.data.providers).toContain('fake');
    // Only `fake` goes through the dev connect route.
    expect(
      (
        await call(
          billingConnectFakeRoute,
          owner,
          '/api/v1/billing/connect/stripe',
          'POST',
          {},
          { provider: 'stripe' },
        )
      ).status,
    ).toBe(404);

    const coach = await createUser(prisma, auth, 'coach-role');
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
          billingSettingsPutRoute,
          headersFor(coach, t.orgA.id),
          '/api/v1/billing/settings',
          'PUT',
          { graceDays: 3 },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          packagesPostRoute,
          headersFor(t.clientA, t.orgA.id),
          '/api/v1/packages',
          'POST',
          { title: 'x', kind: 'one_off', amountMinor: 1 },
        )
      ).status,
    ).toBe(403);
  });

  it('records a manual payment; the client sees their own receipt; another workspace sees nothing', async () => {
    const owner = headersFor(t.coachA, t.orgA.id);
    const pkg = (await (
      await call(packagesPostRoute, owner, '/api/v1/packages', 'POST', {
        title: '10 sessions',
        kind: 'one_off',
        amountMinor: 50000,
      })
    ).json()) as { data: { id: string } };
    const res = await call(manualPaymentRoute, owner, '/api/v1/payments/manual', 'POST', {
      clientId: clientAId,
      packageId: pkg.data.id,
      method: 'cash',
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { paymentId: string; receiptNo: number } };
    expect(data.receiptNo).toBe(1);

    const mine = await call(
      receiptGetRoute,
      headersFor(t.clientA, t.orgA.id),
      `/api/v1/payments/${data.paymentId}/receipt`,
      'GET',
      undefined,
      { id: data.paymentId },
    );
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({
      data: { receiptNo: 1, amountMinor: 50000, packageTitle: '10 sessions' },
    });
    const purchases = (await (
      await call(purchasesGetRoute, headersFor(t.clientA, t.orgA.id), '/api/v1/purchases')
    ).json()) as {
      data: { clientId: string }[];
    };
    expect(purchases.data.map((p) => p.clientId)).toEqual([clientAId]);

    const other = headersFor(t.coachB, t.orgB.id);
    expect(
      (
        await call(
          receiptGetRoute,
          other,
          `/api/v1/payments/${data.paymentId}/receipt`,
          'GET',
          undefined,
          { id: data.paymentId },
        )
      ).status,
    ).toBe(404);
    const theirs = (await (await call(paymentsGetRoute, other, '/api/v1/payments')).json()) as {
      data: unknown[];
    };
    expect(theirs.data).toEqual([]);
    // The dual-role user acting as a client of B can't name A's client.
    const dual = await call(
      paymentsGetRoute,
      headersFor(t.dualRoleUser, t.orgB.id),
      `/api/v1/payments?clientId=${clientAId}`,
    );
    expect(dual.status).toBe(404);
  });

  it('OAuth state binds the user, workspace and provider for 15 minutes', () => {
    const now = Date.now();
    const s = signConnectState('u1', 'o1', 'stripe', now);
    expect(verifyConnectState(s, 'u1', 'o1', 'stripe', now)).toBe(true);
    expect(verifyConnectState(s, 'u2', 'o1', 'stripe', now)).toBe(false);
    expect(verifyConnectState(s, 'u1', 'o2', 'stripe', now)).toBe(false);
    expect(verifyConnectState(s, 'u1', 'o1', 'razorpay', now)).toBe(false);
    expect(verifyConnectState(s, 'u1', 'o1', 'stripe', now + 16 * 60_000)).toBe(false);
    expect(verifyConnectState(`${s}x`, 'u1', 'o1', 'stripe', now)).toBe(false);
  });
});
