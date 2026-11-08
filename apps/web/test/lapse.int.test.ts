import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError, setSubscriptionLapse } from '@repsy/core';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler, type RouteDef } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { headersFor, seedTwoTenants, TEST_SECRET, type TwoTenants } from './harness/tenants';

/**
 * PRD M12 through the API gate: after a lapse a workspace is read-only (exports still work), then closed; a workspace
 * without an open lapse is untouched; only a platform admin records or ends a lapse.
 */
const ORIGIN = 'http://localhost:3000';
const DAY = 86_400_000;

let prisma: PrismaClient;
let drop: () => Promise<void>;
let auth: Auth;
let t: TwoTenants;
let adminId: string;

beforeAll(async () => {
  let authPrisma: PrismaClient;
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({
    prisma,
    authPrisma,
    env: {
      BETTER_AUTH_URL: ORIGIN,
      BETTER_AUTH_SECRET: TEST_SECRET,
      DISABLE_BREACHED_PASSWORD_CHECK: 'true',
    },
  });
  t = await seedTwoTenants(prisma, auth);
  adminId = await withSystem(
    async (tx) =>
      (
        await tx.user.create({
          data: { email: 'admin@example.test', name: 'Admin', isPlatformAdmin: true },
        })
      ).id,
    prisma,
  );
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

const api = createApiHandler({
  get auth() {
    return auth;
  },
  get prisma() {
    return prisma;
  },
  secret: TEST_SECRET,
  appBaseUrl: ORIGIN,
  limiter: new InMemoryRateLimiter({ capacity: 1000, refillPerSecond: 1000 }),
});

const call = async (
  method: 'GET' | 'POST',
  user: TwoTenants['coachA'],
  orgId: string,
  def: Partial<RouteDef<undefined, true>> = {},
) => {
  const headers = headersFor(user, orgId);
  if (method !== 'GET') headers.set('origin', ORIGIN);
  const res = await api({ handler: () => ({ ok: true }), ...def })(
    new Request(`${ORIGIN}/api/v1/test`, { method, headers }),
  );
  return res.status;
};

const admin = (isPlatformAdmin = true) => ({ userId: adminId, isPlatformAdmin });
const lapse = (input: Record<string, unknown>, who = admin()) =>
  withSystem((tx) => setSubscriptionLapse(tx, who, input), prisma);

describe('post-lapse access (M12)', () => {
  it('leaves a workspace without a lapse alone', async () => {
    expect(await call('POST', t.coachA, t.orgA.id)).toBe(200);
  });

  it('only a platform admin records a lapse', async () => {
    const error = await lapse({ organizationId: t.orgA.id, action: 'lapse' }, admin(false)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('NOT_FOUND');
  });

  it('is read-only while the window runs: reads and exports work, writes do not', async () => {
    await lapse({
      organizationId: t.orgA.id,
      action: 'lapse',
      lapsedAt: new Date(Date.now() - 10 * DAY).toISOString(),
    });
    expect(await call('GET', t.coachA, t.orgA.id)).toBe(200);
    expect(await call('POST', t.coachA, t.orgA.id)).toBe(403);
    expect(await call('POST', t.coachA, t.orgA.id, { lapse: 'export' })).toBe(200);
    expect(await call('POST', t.coachA, t.orgA.id, { lapse: 'exempt' })).toBe(200);
    // Another workspace is unaffected.
    expect(await call('POST', t.coachB, t.orgB.id)).toBe(200);
  });

  it('closes reads for clients after 90 days while the coach keeps 180', async () => {
    await withSystem(
      (tx) =>
        tx.subscriptionLapse.updateMany({
          where: { organizationId: t.orgA.id },
          data: { lapsedAt: new Date(Date.now() - 120 * DAY) },
        }),
      prisma,
    );
    expect(await call('GET', t.clientA, t.orgA.id)).toBe(403);
    expect(await call('GET', t.clientA, t.orgA.id, { lapse: 'exempt' })).toBe(200);
    expect(await call('GET', t.coachA, t.orgA.id)).toBe(200);
    expect(await call('POST', t.coachA, t.orgA.id)).toBe(403);
  });

  it('gives full access back once the admin ends the lapse', async () => {
    await lapse({ organizationId: t.orgA.id, action: 'resolve' });
    expect(await call('POST', t.coachA, t.orgA.id)).toBe(200);
    expect(await call('GET', t.clientA, t.orgA.id)).toBe(200);
  });
});
