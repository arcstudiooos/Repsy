import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertAllowedEvent, type AnalyticsEvent, type AnalyticsPort } from '@repsy/core';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler, type RouteDef } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { messagesPostRoute, threadMeRoute } from '@/server/routes/messages';
import { reviewFlagPatchRoute, reviewFlagPostRoute } from '@/server/routes/reviewFlags';
import {
  sessionCompleteRoute,
  sessionLogsRoute,
  sessionStartRoute,
} from '@/server/routes/workoutSessions';
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
const events: AnalyticsEvent[] = [];
/** The spy adapter enforces the allowlist exactly like the PostHog adapter. */
const spy: AnalyticsPort = {
  capture(e) {
    assertAllowedEvent(e);
    events.push(e);
  },
};

const api = () =>
  createApiHandler({
    auth,
    prisma,
    secret: TEST_SECRET,
    appBaseUrl: ORIGIN,
    limiter: new InMemoryRateLimiter({ capacity: 1000, refillPerSecond: 1000 }),
    analytics: spy,
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRoute = RouteDef<any, true>;
const call = (
  route: AnyRoute,
  headers: Headers,
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  body?: unknown,
  id = '',
) => {
  const h = new Headers(headers);
  if (body !== undefined) {
    h.set('origin', ORIGIN);
    h.set('content-type', 'application/json');
  }
  return api()(route)(
    new Request(`${ORIGIN}/api/v1${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
};
const asCoachA = () => headersFor(t.coachA, t.orgA.id);
const asClientA = () => headersFor(t.clientA, t.orgA.id);

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

describe('product events (S5-4)', () => {
  it('emits §13 events once per real change, with hashed ids and no names, emails or text', async () => {
    const id = a.sessionIds[0]!;
    for (let i = 0; i < 2; i++)
      await call(sessionStartRoute, asClientA(), `/sessions/${id}/start`, 'POST', {}, id);
    await call(
      sessionLogsRoute,
      asClientA(),
      `/sessions/${id}/logs`,
      'POST',
      {
        items: [
          {
            workoutVersionExerciseId: a.exerciseIds.bench,
            setIndex: 0,
            reps: 5,
            weightKg: 50,
            clientUpdatedAt: new Date(Date.now() - 1000).toISOString(),
            clientMutationId: randomUUID(),
          },
        ],
      },
      id,
    );
    const key = randomUUID();
    for (let i = 0; i < 2; i++) {
      await call(
        sessionCompleteRoute,
        asClientA(),
        `/sessions/${id}/complete`,
        'POST',
        { idempotencyKey: key },
        id,
      );
    }
    const secretText = 'Private words about my shoulder';
    const me = await (await call(threadMeRoute, asClientA(), '/threads/me', 'GET')).json();
    await call(
      messagesPostRoute,
      asClientA(),
      `/threads/${me.data.id}/messages`,
      'POST',
      { body: secretText },
      me.data.id,
    );
    await call(
      messagesPostRoute,
      asCoachA(),
      `/threads/${me.data.id}/messages`,
      'POST',
      { body: secretText },
      me.data.id,
    );
    const f = await (
      await call(reviewFlagPostRoute, asCoachA(), '/review-flags', 'POST', {
        clientId: a.clientId,
        title: 'Follow up',
      })
    ).json();
    await call(
      reviewFlagPatchRoute,
      asCoachA(),
      `/review-flags/${f.data.id}`,
      'PATCH',
      { action: 'resolve', reason: secretText },
      f.data.id,
    );

    expect(events.map((e) => e.name)).toEqual([
      'workout_started',
      'workout_completed',
      'coach_message_sent',
      'review_flag_opened',
      'review_flag_resolved',
    ]);
    expect(events[1]?.properties).toMatchObject({ set_count: 1, logged_by_coach: false });
    for (const e of events) expect(e.distinctId).toMatch(/^[0-9a-f]{64}$/);
    const users = await withSystem(
      (tx) => tx.user.findMany({ select: { name: true, email: true } }),
      prisma,
    );
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(secretText);
    for (const u of users) {
      expect(serialized).not.toContain(u.email);
      expect(serialized).not.toContain(u.name);
    }
    expect(serialized).not.toContain(a.clientId);
    expect(serialized).not.toContain(t.coachA.id);
  });
});
