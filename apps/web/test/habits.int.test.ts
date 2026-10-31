import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler, type RouteDef } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { habitLogRoute, habitsListRoute, habitsPostRoute } from '@/server/routes/habits';
import { headersFor, seedTwoTenants, TEST_SECRET, type TwoTenants } from './harness/tenants';
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
let clientId: string;

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
  method: 'GET' | 'POST',
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
  clientId = await linkClient(prisma, t.orgA.id, t.clientA.id, t.coachA.id);
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('habits API (PRD G1-G3)', () => {
  it('coach assigns; the client ticks through the API and the tick is stored', async () => {
    const coach = headersFor(t.coachA, t.orgA.id);
    const client = headersFor(t.clientA, t.orgA.id);
    const created = await call(
      habitsPostRoute,
      coach,
      `/clients/${clientId}/habits`,
      'POST',
      { title: 'Walk' },
      clientId,
    );
    expect(created.status).toBe(201);
    const habit = (await created.json()).data as { id: string };
    const ticked = await call(
      habitLogRoute,
      client,
      `/habits/${habit.id}/log`,
      'POST',
      { done: true },
      habit.id,
    );
    expect(ticked.status).toBe(200);
    expect((await ticked.json()).data).toMatchObject({ doneToday: true });
    const stored = await withSystem(
      (tx) => tx.habitLog.count({ where: { habitId: habit.id } }),
      prisma,
    );
    expect(stored).toBe(1);
    const listed = await (
      await call(habitsListRoute, client, `/clients/${clientId}/habits`, 'GET', undefined, clientId)
    ).json();
    expect(listed.data.habits[0]).toMatchObject({ doneToday: true });
    // Another org's coach can't read them.
    expect(
      (
        await call(
          habitsListRoute,
          headersFor(t.coachB, t.orgB.id),
          `/clients/${clientId}/habits`,
          'GET',
          undefined,
          clientId,
        )
      ).status,
    ).toBe(404);
  });
});
