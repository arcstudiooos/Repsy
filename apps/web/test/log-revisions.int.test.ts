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
  sessionLogsReviseRoute,
  sessionLogsRoute,
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
  method: 'GET' | 'POST' | 'PATCH',
  body?: unknown,
) => {
  const h = new Headers(headers);
  if (body !== undefined) {
    h.set('origin', ORIGIN);
    h.set('content-type', 'application/json');
  }
  return api()(route)(
    new Request(`${ORIGIN}/api/v1/sessions/${id}${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
};
const patch = (headers: Headers, id: string, body: unknown) =>
  call(sessionLogsReviseRoute, headers, id, '/logs', 'PATCH', body);
const asClientA = () => headersFor(t.clientA, t.orgA.id);
const asCoachA = () => headersFor(t.coachA, t.orgA.id);
const logItem = (wve: string, setIndex: number, over: Record<string, unknown> = {}) => ({
  workoutVersionExerciseId: wve,
  setIndex,
  reps: 8,
  weightKg: 60,
  clientUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
  clientMutationId: randomUUID(),
  ...over,
});
const revisionCount = (sessionId: string) =>
  withSystem((tx) => tx.setLogRevision.count({ where: { sessionId } }), prisma);

/** Client A starts, logs bench set 1 and completes session `index`. */
async function finish(index: number): Promise<string> {
  const id = a.sessionIds[index]!;
  expect((await call(sessionStartRoute, asClientA(), id, '/start', 'POST', {})).status).toBe(200);
  const items = [logItem(a.exerciseIds.bench, 0)];
  expect((await call(sessionLogsRoute, asClientA(), id, '/logs', 'POST', { items })).status).toBe(
    200,
  );
  const done = await call(sessionCompleteRoute, asClientA(), id, '/complete', 'POST', {
    idempotencyKey: randomUUID(),
  });
  expect(done.status).toBe(200);
  return id;
}

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
  const clientA = await linkClient(prisma, t.orgA.id, t.clientA.id, t.coachA.id);
  a = await seedAssignment(prisma, t.orgA.id, clientA, t.coachA.id, { days: 5 });
  siblingUser = await createUser(prisma, auth, 'sibling');
  await withSystem(
    (tx) =>
      tx.membership.create({
        data: { userId: siblingUser.id, organizationId: t.orgA.id, role: 'client' },
      }),
    prisma,
  );
  await linkClient(prisma, t.orgA.id, siblingUser.id, t.coachA.id);
  // The dual-role user is a client of org B (so their B actor has a clientId).
  await linkClient(prisma, t.orgB.id, t.dualRoleUser.id, t.coachB.id);
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('PATCH /api/v1/sessions/:id/logs (S3-4)', () => {
  it('the client edits within 24h; the coach corrects with a reason the client never sees', async () => {
    const id = await finish(0);
    const edit = await patch(asClientA(), id, {
      items: [logItem(a.exerciseIds.bench, 0, { reps: 10 })],
    });
    expect(edit.status).toBe(200);
    expect(await edit.json()).toMatchObject({ data: [{ status: 'saved', value: { reps: 10 } }] });
    const fix = await patch(asCoachA(), id, {
      items: [logItem(a.exerciseIds.bench, 0, { reps: 9 })],
      reason: 'Counted on video',
    });
    expect(fix.status).toBe(200);
    expect(await revisionCount(id)).toBe(2);

    const asClient = await (await call(sessionGetRoute, asClientA(), id, '', 'GET')).json();
    expect(asClient.data.revisions).toMatchObject([
      { role: 'client', reason: null },
      { role: 'coach', reason: null },
    ]);
    expect(JSON.stringify(asClient)).not.toContain('Counted on video');
    expect(typeof asClient.data.editableUntil).toBe('string');
    const asCoach = await (await call(sessionGetRoute, asCoachA(), id, '', 'GET')).json();
    expect(asCoach.data.revisions[1]).toMatchObject({ role: 'coach', reason: 'Counted on video' });
  });

  it('a client of org B, a coach of org B and a sibling client all get 404 (Review Focus #4)', async () => {
    const id = await finish(1);
    const items = [logItem(a.exerciseIds.bench, 0, { reps: 1 })];
    for (const headers of [
      headersFor(t.dualRoleUser, t.orgB.id),
      headersFor(t.coachB, t.orgB.id),
      headersFor(siblingUser, t.orgA.id),
    ]) {
      const res = await patch(headers, id, { items, reason: 'Nope' });
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
    expect(await revisionCount(id)).toBe(0);
  });

  it('window closed → 403 EDIT_WINDOW_CLOSED; the coach can still correct', async () => {
    const id = await finish(2);
    await withSystem(
      (tx) =>
        tx.workoutSession.update({
          where: { id },
          data: { submittedAt: new Date(Date.now() - 24 * 3_600_000 - 60_000) },
        }),
      prisma,
    );
    const items = [logItem(a.exerciseIds.bench, 0, { reps: 12 })];
    const res = await patch(asClientA(), id, { items });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: {
        code: 'EDIT_WINDOW_CLOSED',
        message: 'You can edit a workout for 24 hours after finishing it.',
      },
    });
    expect((await patch(asCoachA(), id, { items, reason: 'Late fix' })).status).toBe(200);
  });

  it('a coach correction without a reason → 422 fieldErrors.reason; in progress → 409', async () => {
    const id = await finish(3);
    const items = [logItem(a.exerciseIds.bench, 0, { reps: 7 })];
    const res = await patch(asCoachA(), id, { items, reason: '  ' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: {
        code: 'VALIDATION',
        fieldErrors: { reason: ['Add a reason for the correction.'] },
      },
    });
    expect(await revisionCount(id)).toBe(0);

    const open = a.sessionIds[4]!;
    expect((await call(sessionStartRoute, asClientA(), open, '/start', 'POST', {})).status).toBe(
      200,
    );
    const busy = await patch(asClientA(), open, { items });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({
      error: { code: 'CONFLICT', message: 'This workout is still in progress.' },
    });
  });
});
