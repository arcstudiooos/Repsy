import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { clientHistoryRoute } from '@/server/routes/clients';
import {
  BENCH,
  linkClient,
  PLANK,
  seedAssignment,
  type SeededAssignment,
} from './harness/sessions';
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
let a: SeededAssignment;

const api = () =>
  createApiHandler({
    auth,
    prisma,
    secret: TEST_SECRET,
    appBaseUrl: ORIGIN,
    limiter: new InMemoryRateLimiter({ capacity: 1000, refillPerSecond: 1000 }),
  });

const history = (headers: Headers, clientId: string, qs: string) =>
  api()(clientHistoryRoute)(
    new Request(`${ORIGIN}/api/v1/clients/${clientId}/history${qs}`, { headers }),
    { params: Promise.resolve({ id: clientId }) },
  );

/** Marks session `index` completed with bench sets of `reps` (system scope; test setup only). */
async function complete(index: number, reps: number[], completedAt: Date) {
  const sessionId = a.sessionIds[index]!;
  await withSystem(async (tx) => {
    await tx.workoutSession.update({
      where: { id: sessionId },
      data: {
        state: 'in_progress',
        workoutVersionId: a.workoutVersionId,
        startedAt: completedAt,
      },
    });
    await tx.setLog.createMany({
      data: reps.map((r, setIndex) => ({
        organizationId: t.orgA.id,
        sessionId,
        workoutVersionExerciseId: a.exerciseIds.bench,
        setIndex,
        reps: r,
        weightKg: 80,
        clientUpdatedAt: completedAt,
        clientMutationId: randomUUID(),
        loggedByUserId: t.clientA.id,
      })),
    });
    await tx.workoutSession.update({
      where: { id: sessionId },
      data: { state: 'completed', completedAt, submittedAt: completedAt },
    });
  }, prisma);
}

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
  const clientA = await linkClient(prisma, t.orgA.id, t.clientA.id, t.coachA.id);
  a = await seedAssignment(prisma, t.orgA.id, clientA, t.coachA.id, {
    days: 3,
    firstDate: '2026-10-05',
  });
  await complete(0, [5, 5], new Date('2026-10-05T18:00:00Z'));
  await complete(1, [6, 4], new Date('2026-10-06T18:00:00Z'));
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('GET /api/v1/clients/:id/history', () => {
  it("returns the last completed session's sets per exercise", async () => {
    const res = await history(
      headersFor(t.coachA, t.orgA.id),
      a.clientId,
      `?exerciseIds=${BENCH},${PLANK}`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: {
        [BENCH]: {
          localDate: '2026-10-06',
          sets: [
            {
              setIndex: 0,
              reps: 6,
              weightKg: 80,
              rpe: null,
              durationSeconds: null,
              distanceM: null,
            },
            {
              setIndex: 1,
              reps: 4,
              weightKg: 80,
              rpe: null,
              durationSeconds: null,
              distanceM: null,
            },
          ],
        },
      },
    });
  });

  it("another org's client → 404", async () => {
    const res = await history(headersFor(t.coachB, t.orgB.id), a.clientId, `?exerciseIds=${BENCH}`);
    expect(res.status).toBe(404);
  });

  it('a client actor → 403', async () => {
    const res = await history(
      headersFor(t.clientA, t.orgA.id),
      a.clientId,
      `?exerciseIds=${BENCH}`,
    );
    expect(res.status).toBe(403);
  });

  it('more than 30 ids or a malformed id → 422', async () => {
    const ids = Array.from({ length: 31 }, () => randomUUID()).join(',');
    expect(
      (await history(headersFor(t.coachA, t.orgA.id), a.clientId, `?exerciseIds=${ids}`)).status,
    ).toBe(422);
    expect(
      (await history(headersFor(t.coachA, t.orgA.id), a.clientId, '?exerciseIds=nope')).status,
    ).toBe(422);
  });
});
