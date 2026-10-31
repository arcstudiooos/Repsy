import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler, type RouteDef } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { checkinsListRoute } from '@/server/routes/checkins';
import { messagesListRoute, threadMeRoute } from '@/server/routes/messages';
import {
  noteDeleteRoute,
  notePatchRoute,
  notesListRoute,
  notesPostRoute,
  timelineRoute,
} from '@/server/routes/notes';
import { sessionGetRoute, sessionsListRoute } from '@/server/routes/workoutSessions';
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
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  id = '',
) => {
  const h = new Headers(headers);
  if (body !== undefined || method !== 'GET') h.set('origin', ORIGIN);
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
const asCoachA = () => headersFor(t.coachA, t.orgA.id);
const asCoachB = () => headersFor(t.coachB, t.orgB.id);
const asClientA = () => headersFor(t.clientA, t.orgA.id);

const SECRET = 'Private: discuss nutrition plan';

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

describe('internal notes (S4-5)', () => {
  it('coach CRUD; the timeline includes it; 404 cross-org', async () => {
    const id = a.clientId;
    const created = await call(
      notesPostRoute,
      asCoachA(),
      `/clients/${id}/notes`,
      'POST',
      { body: SECRET },
      id,
    );
    expect(created.status).toBe(201);
    const note = (await created.json()).data;
    const listed = await (
      await call(notesListRoute, asCoachA(), `/clients/${id}/notes`, 'GET', undefined, id)
    ).json();
    expect(listed.data[0]).toMatchObject({ id: note.id, body: SECRET, mine: true });
    const timeline = await (
      await call(timelineRoute, asCoachA(), `/clients/${id}/timeline`, 'GET', undefined, id)
    ).json();
    expect(timeline.data.find((e: { kind: string }) => e.kind === 'note')).toMatchObject({
      private: true,
    });
    expect(
      (await call(notesListRoute, asCoachB(), `/clients/${id}/notes`, 'GET', undefined, id)).status,
    ).toBe(404);
    expect(
      (await call(notePatchRoute, asCoachB(), `/notes/${note.id}`, 'PATCH', { body: 'x' }, note.id))
        .status,
    ).toBe(404);
  });

  it('client-role requests → 403, and no portal payload contains a note', async () => {
    const id = a.clientId;
    expect(
      (await call(notesListRoute, asClientA(), `/clients/${id}/notes`, 'GET', undefined, id))
        .status,
    ).toBe(403);
    expect(
      (await call(notesPostRoute, asClientA(), `/clients/${id}/notes`, 'POST', { body: 'x' }, id))
        .status,
    ).toBe(403);
    expect(
      (await call(timelineRoute, asClientA(), `/clients/${id}/timeline`, 'GET', undefined, id))
        .status,
    ).toBe(403);
    const [note] = (
      await (
        await call(notesListRoute, asCoachA(), `/clients/${id}/notes`, 'GET', undefined, id)
      ).json()
    ).data;
    expect(
      (await call(noteDeleteRoute, asClientA(), `/notes/${note.id}`, 'DELETE', undefined, note.id))
        .status,
    ).toBe(403);

    const me = await (await call(threadMeRoute, asClientA(), '/threads/me', 'GET')).json();
    const payloads = [
      await call(sessionsListRoute, asClientA(), '/sessions', 'GET'),
      await call(sessionsListRoute, asClientA(), '/sessions?scope=past', 'GET'),
      await call(
        sessionGetRoute,
        asClientA(),
        `/sessions/${a.sessionIds[0]}`,
        'GET',
        undefined,
        a.sessionIds[0],
      ),
      await call(checkinsListRoute, asClientA(), '/checkins', 'GET'),
      await call(
        messagesListRoute,
        asClientA(),
        `/threads/${me.data.id}/messages`,
        'GET',
        undefined,
        me.data.id,
      ),
    ];
    for (const res of payloads) {
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(SECRET);
      expect(text).not.toMatch(/internal_?note/i);
    }
    expect(JSON.stringify(me)).not.toContain(SECRET);
  });
});
