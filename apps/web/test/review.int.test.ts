import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { reviewGetRoute, reviewSeenRoute } from '@/server/routes/review';
import { sessionCompleteRoute } from '@/server/routes/workoutSessions';
import { headersFor, seedTwoTenants, TEST_SECRET, type TwoTenants } from './harness/tenants';
import { linkClient, seedAssignment, type SeededAssignment } from './harness/sessions';

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
let a: SeededAssignment;

const api = () =>
  createApiHandler({
    auth,
    prisma,
    secret: TEST_SECRET,
    appBaseUrl: ORIGIN,
    limiter: new InMemoryRateLimiter({ capacity: 1000, refillPerSecond: 1000 }),
  });
const getReview = (headers: Headers) =>
  api()(reviewGetRoute)(new Request(`${ORIGIN}/api/v1/review`, { headers }));
const markSeen = (headers: Headers, origin = true) => {
  const h = new Headers(headers);
  if (origin) h.set('origin', ORIGIN);
  h.set('content-type', 'application/json');
  return api()(reviewSeenRoute)(
    new Request(`${ORIGIN}/api/v1/review/seen`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ through: new Date().toISOString() }),
    }),
  );
};

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
  const clientA = await linkClient(prisma, t.orgA.id, t.clientA.id, t.coachA.id);
  a = await seedAssignment(prisma, t.orgA.id, clientA, t.coachA.id, { days: 1 });
  const h = new Headers(headersFor(t.clientA, t.orgA.id));
  h.set('origin', ORIGIN);
  h.set('content-type', 'application/json');
  const done = await api()(sessionCompleteRoute)(
    new Request(`${ORIGIN}/api/v1/sessions/${a.sessionIds[0]}/complete`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({ idempotencyKey: randomUUID() }),
    }),
    { params: Promise.resolve({ id: a.sessionIds[0]! }) },
  );
  expect(done.status).toBe(200);
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('review API', () => {
  it("coach A sees the completion; coach B never sees org A's sessions", async () => {
    const mine = await getReview(headersFor(t.coachA, t.orgA.id));
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({
      data: { newCompleted: { count: 1, items: [{ sessionId: a.sessionIds[0] }] } },
    });
    const theirs = (await (await getReview(headersFor(t.coachB, t.orgB.id))).json()) as {
      data: { newCompleted: { count: number }; dueThisWeek: { count: number } };
    };
    expect(theirs.data.newCompleted.count).toBe(0);
    expect(JSON.stringify(theirs)).not.toContain(a.sessionIds[0]);
  });

  it('client role → 403; mark seen needs the Origin check and then empties new completions', async () => {
    expect((await getReview(headersFor(t.clientA, t.orgA.id))).status).toBe(403);
    expect((await markSeen(headersFor(t.clientA, t.orgA.id))).status).toBe(403);
    expect((await markSeen(headersFor(t.coachA, t.orgA.id), false)).status).toBe(403);
    expect((await markSeen(headersFor(t.coachA, t.orgA.id))).status).toBe(200);
    const after = (await (await getReview(headersFor(t.coachA, t.orgA.id))).json()) as {
      data: { newCompleted: { count: number }; seenAt: string | null };
    };
    expect(after.data.newCompleted.count).toBe(0);
    expect(after.data.seenAt).not.toBeNull();
  });
});
