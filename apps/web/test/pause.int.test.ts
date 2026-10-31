import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler, type RouteDef } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import {
  clientGetRoute,
  clientPatchRoute,
  clientPausePatchRoute,
  clientPausePostRoute,
  clientResumeRoute,
} from '@/server/routes/clients';
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
    new Request(`${ORIGIN}/api/v1/clients/${id}${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
};
const asCoachA = () => headersFor(t.coachA, t.orgA.id);
const asCoachB = () => headersFor(t.coachB, t.orgB.id);
const asClientA = () => headersFor(t.clientA, t.orgA.id);

const PAUSE = { startLocalDate: '2099-01-04', resumeLocalDate: '2099-01-11' };
const firstDate = () =>
  withSystem(
    (tx) =>
      tx.workoutSession.findUniqueOrThrow({
        where: { id: a.sessionIds[0]! },
        select: { scheduledLocalDate: true },
      }),
    prisma,
  ).then((s) => s.scheduledLocalDate.toISOString().slice(0, 10));

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
  const clientA = await linkClient(prisma, t.orgA.id, t.clientA.id, t.coachA.id);
  a = await seedAssignment(prisma, t.orgA.id, clientA, t.coachA.id, { days: 2 });
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('client pause routes (S3-5)', () => {
  it('pause, replay, change the resume date, resume now', async () => {
    const id = a.clientId;
    expect(await firstDate()).toBe('2099-01-05');
    const res = await call(clientPausePostRoute, asCoachA(), id, '/pause', 'POST', PAUSE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ status: 'paused', pause: PAUSE });
    expect(body.meta).toEqual({ shifted: 2 });
    expect(await firstDate()).toBe('2099-01-12');

    const replay = await call(clientPausePostRoute, asCoachA(), id, '/pause', 'POST', PAUSE);
    expect((await replay.json()).meta).toEqual({ shifted: 0 });
    expect(await firstDate()).toBe('2099-01-12');

    const got = await call(clientGetRoute, asCoachA(), id, '', 'GET');
    expect((await got.json()).data.pause).toEqual(PAUSE);

    const changed = await call(clientPausePatchRoute, asCoachA(), id, '/pause', 'PATCH', {
      resumeLocalDate: '2099-01-18',
    });
    expect(changed.status).toBe(200);
    expect(await firstDate()).toBe('2099-01-19');

    // Status changes to or from paused go through the pause API only.
    const viaPatch = await call(clientPatchRoute, asCoachA(), id, '', 'PATCH', {
      status: 'active',
    });
    expect(viaPatch.status).toBe(422);
    expect((await viaPatch.json()).error.fieldErrors).toEqual({
      status: ['Use Pause program to pause or resume.'],
    });

    const resumed = await call(clientResumeRoute, asCoachA(), id, '/pause/resume', 'POST', {});
    expect(resumed.status).toBe(200);
    expect((await resumed.json()).data).toMatchObject({ status: 'active', pause: null });
    // Resumed before the pause started: the original dates are back.
    expect(await firstDate()).toBe('2099-01-05');
  });

  it('422 field errors, 404 cross-org and without a pause, 403 for a client actor', async () => {
    const id = a.clientId;
    const past = await call(clientPausePostRoute, asCoachA(), id, '/pause', 'POST', {
      startLocalDate: '2020-01-01',
      resumeLocalDate: '2020-01-08',
    });
    expect(past.status).toBe(422);
    expect((await past.json()).error.fieldErrors).toHaveProperty('startLocalDate');

    expect((await call(clientPausePostRoute, asCoachB(), id, '/pause', 'POST', PAUSE)).status).toBe(
      404,
    );
    expect(
      (
        await call(clientPausePatchRoute, asCoachA(), id, '/pause', 'PATCH', {
          resumeLocalDate: '2099-01-18',
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(clientResumeRoute, asCoachB(), id, '/pause/resume', 'POST', {})).status,
    ).toBe(404);
    expect(
      (await call(clientPausePostRoute, asClientA(), id, '/pause', 'POST', PAUSE)).status,
    ).toBe(403);
  });
});
