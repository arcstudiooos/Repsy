import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler, type RouteDef } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import {
  sessionCompleteRoute,
  sessionGetRoute,
  sessionLogsRoute,
  sessionSkipRoute,
  sessionsListRoute,
  sessionStartRoute,
} from '@/server/routes/workoutSessions';
import {
  createUser,
  headersFor,
  seedTwoTenants,
  TEST_SECRET,
  type SeededUser,
  type TwoTenants,
} from './harness/tenants';
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
let sibling: SeededAssignment;
let siblingUser: SeededUser;

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
  id: string,
  path: string,
  body?: unknown,
  opts: { origin?: boolean } = {},
) => {
  const h = new Headers(headers);
  if (body !== undefined) {
    if (opts.origin !== false) h.set('origin', ORIGIN);
    h.set('content-type', 'application/json');
  }
  return api()(route)(
    new Request(`${ORIGIN}/api/v1/sessions/${id}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
};
const asClientA = () => headersFor(t.clientA, t.orgA.id);
const logItem = (wve: string, setIndex: number, over: Record<string, unknown> = {}) => ({
  workoutVersionExerciseId: wve,
  setIndex,
  reps: 8,
  weightKg: 60,
  clientUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
  clientMutationId: randomUUID(),
  ...over,
});
const audits = (objectId: string, action: string) =>
  withSystem((tx) => tx.auditEvent.count({ where: { objectId, action } }), prisma);

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
  const clientA = await linkClient(prisma, t.orgA.id, t.clientA.id, t.coachA.id);
  a = await seedAssignment(prisma, t.orgA.id, clientA, t.coachA.id, { days: 4 });
  siblingUser = await createUser(prisma, auth, 'sibling');
  await withSystem(
    (tx) =>
      tx.membership.create({
        data: { userId: siblingUser.id, organizationId: t.orgA.id, role: 'client' },
      }),
    prisma,
  );
  const siblingId = await linkClient(prisma, t.orgA.id, siblingUser.id, t.coachA.id);
  sibling = await seedAssignment(prisma, t.orgA.id, siblingId, t.coachA.id);
  // The dual-role user is a client of org B (so their B actor has a clientId).
  await linkClient(prisma, t.orgB.id, t.dualRoleUser.id, t.coachB.id);
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('session logging API', () => {
  it('client starts, logs, completes; the same complete body 3x gives one completion', async () => {
    const id = a.sessionIds[0]!;
    const start = await call(sessionStartRoute, asClientA(), id, '/start', {});
    expect(start.status).toBe(200);
    expect(await start.json()).toMatchObject({
      data: { session: { state: 'in_progress' }, workout: { locked: true, title: 'Full body' } },
    });
    const items = [logItem(a.exerciseIds.bench, 0), logItem(a.exerciseIds.bench, 1)];
    for (let i = 0; i < 3; i++) {
      const logs = await call(sessionLogsRoute, asClientA(), id, '/logs', { items });
      expect(logs.status).toBe(200);
    }
    expect(await withSystem((tx) => tx.setLog.count({ where: { sessionId: id } }), prisma)).toBe(2);
    const body = { idempotencyKey: randomUUID() };
    for (let i = 0; i < 3; i++) {
      const res = await call(sessionCompleteRoute, asClientA(), id, '/complete', body);
      expect(res.status).toBe(200);
    }
    expect(await audits(id, 'session.completed')).toBe(1);
    const detail = await call(sessionGetRoute, asClientA(), id, '');
    expect(await detail.json()).toMatchObject({
      data: { session: { state: 'completed' }, logs: [{ setIndex: 0 }, { setIndex: 1 }] },
    });
  });

  it('a client of org B gets 404 on every endpoint for an org A session (Review Focus #3)', async () => {
    const id = a.sessionIds[1]!;
    const asB = headersFor(t.dualRoleUser, t.orgB.id);
    expect((await call(sessionGetRoute, asB, id, '')).status).toBe(404);
    expect((await call(sessionStartRoute, asB, id, '/start', {})).status).toBe(404);
    const items = [logItem(a.exerciseIds.bench, 0)];
    expect((await call(sessionLogsRoute, asB, id, '/logs', { items })).status).toBe(404);
    const fin = { idempotencyKey: randomUUID() };
    expect((await call(sessionCompleteRoute, asB, id, '/complete', fin)).status).toBe(404);
    expect((await call(sessionSkipRoute, asB, id, '/skip', fin)).status).toBe(404);
    // Coach B too.
    expect((await call(sessionGetRoute, headersFor(t.coachB, t.orgB.id), id, '')).status).toBe(404);
  });

  it("a client can't reach a sibling client's session in the same org (404)", async () => {
    const theirs = sibling.sessionIds[0]!;
    expect((await call(sessionGetRoute, asClientA(), theirs, '')).status).toBe(404);
    expect((await call(sessionStartRoute, asClientA(), theirs, '/start', {})).status).toBe(404);
    const fin = { idempotencyKey: randomUUID() };
    expect((await call(sessionCompleteRoute, asClientA(), theirs, '/complete', fin)).status).toBe(
      404,
    );
    expect((await call(sessionSkipRoute, asClientA(), theirs, '/skip', fin)).status).toBe(404);
    // Even once the sibling has started, their session takes no logs from another client.
    expect(
      (await call(sessionStartRoute, headersFor(siblingUser, t.orgA.id), theirs, '/start', {}))
        .status,
    ).toBe(200);
    const items = [logItem(sibling.exerciseIds.bench, 0)];
    expect((await call(sessionLogsRoute, asClientA(), theirs, '/logs', { items })).status).toBe(
      404,
    );
    expect(
      await withSystem((tx) => tx.setLog.count({ where: { sessionId: theirs } }), prisma),
    ).toBe(0);
    const state = await withSystem(
      (tx) => tx.workoutSession.findUniqueOrThrow({ where: { id: theirs } }),
      prisma,
    );
    expect(state.state).toBe('in_progress');
  });

  it('rpe 11 → 422 with fieldErrors; a missing Origin on a mutation → 403', async () => {
    const id = a.sessionIds[2]!;
    await call(sessionStartRoute, asClientA(), id, '/start', {});
    const bad = await call(sessionLogsRoute, asClientA(), id, '/logs', {
      items: [logItem(a.exerciseIds.bench, 0, { rpe: 11 })],
    });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({
      error: { code: 'VALIDATION', fieldErrors: { items: [expect.stringContaining('rpe')] } },
    });
    const noOrigin = await call(
      sessionCompleteRoute,
      asClientA(),
      id,
      '/complete',
      { idempotencyKey: randomUUID() },
      { origin: false },
    );
    expect(noOrigin.status).toBe(403);
    const badKey = await call(sessionCompleteRoute, asClientA(), id, '/complete', {
      idempotencyKey: 'nope',
    });
    expect(badKey.status).toBe(422);
  });

  it('coach A logs and completes for the client; the client sees loggedByCoach', async () => {
    const id = a.sessionIds[3]!;
    const coach = headersFor(t.coachA, t.orgA.id);
    expect((await call(sessionStartRoute, coach, id, '/start', {})).status).toBe(200);
    expect(
      (
        await call(sessionLogsRoute, coach, id, '/logs', {
          items: [
            logItem(a.exerciseIds.plank, 0, { reps: null, weightKg: null, durationSeconds: 60 }),
          ],
        })
      ).status,
    ).toBe(200);
    const done = await call(sessionCompleteRoute, coach, id, '/complete', {
      idempotencyKey: randomUUID(),
    });
    expect(done.status).toBe(200);
    const list = await api()(sessionsListRoute)(
      new Request(`${ORIGIN}/api/v1/sessions?scope=past`, { headers: asClientA() }),
    );
    const { data } = (await list.json()) as { data: { id: string; loggedByCoach: boolean }[] };
    expect(data.find((s) => s.id === id)?.loggedByCoach).toBe(true);
    expect(await audits(id, 'session.logged_by_coach')).toBe(1);
  });

  it('an archived client loses access: 404 on their own sessions (D-010 #4)', async () => {
    const id = sibling.sessionIds[1]!;
    await withSystem(
      (tx) => tx.client.update({ where: { id: sibling.clientId }, data: { status: 'archived' } }),
      prisma,
    );
    const asArchived = headersFor(siblingUser, t.orgA.id);
    expect((await call(sessionGetRoute, asArchived, id, '')).status).toBe(404);
    expect((await call(sessionStartRoute, asArchived, id, '/start', {})).status).toBe(404);
    const list = await api()(sessionsListRoute)(
      new Request(`${ORIGIN}/api/v1/sessions`, { headers: asArchived }),
    );
    expect(list.status).toBe(404);
  });
});
