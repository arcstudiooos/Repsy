import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler, type RouteDef } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { tagsListRoute, tagsPostRoute } from '@/server/routes/tags';
import { exportsPostRoute } from '@/server/routes/exports';
import { clearLapseCache, setWorkspaceLapsed } from '@kinetic/core';
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
  process.env.FAKE_PAYMENTS = 'on';
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('access after a lapse (M12, D-013 #16)', () => {
  it('refuses writes with WORKSPACE_LAPSED, keeps reads and the exempt routes, and lifts on restore', async () => {
    const owner = headersFor(t.coachA, t.orgA.id);
    const admin = { userId: t.coachA.id, isPlatformAdmin: true };
    expect(
      (await call(tagsPostRoute, owner, '/api/v1/tags', 'POST', { name: 'Before' })).status,
    ).toBe(201);

    await withSystem((tx) => setWorkspaceLapsed(tx, admin, t.orgA.id, true), prisma);
    clearLapseCache();
    const refused = await call(tagsPostRoute, owner, '/api/v1/tags', 'POST', { name: 'After' });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ error: { code: 'WORKSPACE_LAPSED' } });
    // Reads still work.
    expect((await call(tagsListRoute, owner, '/api/v1/tags')).status).toBe(200);
    // Exports stay open.
    const exp = await call(exportsPostRoute, owner, '/api/v1/exports', 'POST', {
      scope: 'org',
      idempotencyKey: 'lapse-export-1',
    });
    expect(exp.status).not.toBe(403);
    // Another workspace is unaffected.
    expect(
      (
        await call(tagsPostRoute, headersFor(t.coachB, t.orgB.id), '/api/v1/tags', 'POST', {
          name: 'B',
        })
      ).status,
    ).toBe(201);

    await withSystem((tx) => setWorkspaceLapsed(tx, admin, t.orgA.id, false), prisma);
    clearLapseCache();
    expect(
      (await call(tagsPostRoute, owner, '/api/v1/tags', 'POST', { name: 'Restored' })).status,
    ).toBe(201);
  });
});
