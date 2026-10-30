import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { assignmentGetRoute, assignPostRoute } from '@/server/routes/assignments';
import { programPatchRoute, programsPostRoute } from '@/server/routes/programs';
import { seedTwoTenants, headersFor, TEST_SECRET, type TwoTenants } from './harness/tenants';

const ORIGIN = 'http://localhost:3000';
const env = {
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: TEST_SECRET,
  DISABLE_BREACHED_PASSWORD_CHECK: 'true',
};
const BENCH = 'e0000000-0000-4000-8000-000000000001';

let prisma: PrismaClient;
let authPrisma: PrismaClient;
let drop: () => Promise<void>;
let auth: Auth;
let t: TwoTenants;
let clientAId: string;

const api = () =>
  createApiHandler({
    auth,
    prisma,
    secret: TEST_SECRET,
    appBaseUrl: ORIGIN,
    limiter: new InMemoryRateLimiter({ capacity: 1000, refillPerSecond: 1000 }),
  });

const mutating = (headers: Headers) => {
  const h = new Headers(headers);
  h.set('origin', ORIGIN);
  h.set('content-type', 'application/json');
  return h;
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const assign = (headers: Headers, programId: string, body: unknown) =>
  api()(assignPostRoute)(
    new Request(`${ORIGIN}/api/v1/programs/${programId}/assign`, {
      method: 'POST',
      headers: mutating(headers),
      body: JSON.stringify(body),
    }),
    ctx(programId),
  );
const getAssignment = (headers: Headers, clientId: string) =>
  api()(assignmentGetRoute)(
    new Request(`${ORIGIN}/api/v1/clients/${clientId}/assignment`, { headers }),
    ctx(clientId),
  );

async function newTemplate(headers: Headers): Promise<string> {
  const created = await api()(programsPostRoute)(
    new Request(`${ORIGIN}/api/v1/programs`, {
      method: 'POST',
      headers: mutating(headers),
      body: JSON.stringify({ title: 'Template' }),
    }),
  );
  const id = ((await created.json()) as { data: { id: string } }).data.id;
  const weeks = [
    {
      days: [
        { title: 'A', exercises: [{ exerciseId: BENCH, sets: [{ reps: 8, loadKg: 60 }] }] },
        { title: 'B', exercises: [{ exerciseId: BENCH, sets: [{ reps: 5 }] }] },
      ],
    },
  ];
  const res = await api()(programPatchRoute)(
    new Request(`${ORIGIN}/api/v1/programs/${id}`, {
      method: 'PATCH',
      headers: mutating(headers),
      body: JSON.stringify({ expectedVersion: null, weeks }),
    }),
    ctx(id),
  );
  expect(res.status).toBe(200);
  return id;
}

// Far in the future: the route uses the real clock and rejects past start dates.
const START = '2099-11-04';
const body = (clientId: string, over: Record<string, unknown> = {}) => ({
  clientId,
  startLocalDate: START,
  weekdays: [1, 3],
  readinessConfirmed: true,
  confirmReplace: false,
  ...over,
});

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
  clientAId = (
    await withSystem(
      (tx) =>
        tx.client.create({
          data: {
            organizationId: t.orgA.id,
            coachUserId: t.coachA.id,
            name: 'Cli',
            email: 'cli@example.test',
            status: 'active',
            timezone: 'America/New_York',
          },
        }),
      prisma,
    )
  ).id;
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('assignment API', () => {
  it('POST assign -> 201, GET summary, repeat -> 409 ACTIVE_ASSIGNMENT_EXISTS', async () => {
    const template = await newTemplate(headersFor(t.coachA));
    const res = await assign(headersFor(t.coachA), template, body(clientAId));
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      data: { assignmentId: string; clientProgramId: string; sessionCount: number };
    };
    expect(created.data.sessionCount).toBe(2);

    const got = await getAssignment(headersFor(t.coachA), clientAId);
    expect(got.status).toBe(200);
    expect(await got.json()).toMatchObject({
      data: {
        assignmentId: created.data.assignmentId,
        programTitle: 'Template',
        startLocalDate: START,
        weekdays: [1, 3],
        sessionCount: 2,
      },
    });

    const again = await assign(headersFor(t.coachA), template, body(clientAId));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: 'ACTIVE_ASSIGNMENT_EXISTS' } });
  });

  it('PATCH title + weeks on the editable client copy -> 200: renamed and committed as version 2 (S3-1)', async () => {
    const template = await newTemplate(headersFor(t.coachA));
    const clientId = (
      await withSystem(
        (tx) =>
          tx.client.create({
            data: {
              organizationId: t.orgA.id,
              coachUserId: t.coachA.id,
              name: 'Copy edit',
              email: 'copy-edit@example.test',
              status: 'active',
              timezone: 'America/New_York',
            },
          }),
        prisma,
      )
    ).id;
    const created = await assign(headersFor(t.coachA), template, body(clientId));
    expect(created.status).toBe(201);
    const { clientProgramId } = ((await created.json()) as { data: { clientProgramId: string } })
      .data;
    const weeks = [
      {
        days: [
          { title: 'A2', exercises: [{ exerciseId: BENCH, sets: [{ reps: 6 }] }] },
          { title: 'B2', exercises: [{ exerciseId: BENCH, sets: [{ reps: 4 }] }] },
        ],
      },
    ];
    const res = await api()(programPatchRoute)(
      new Request(`${ORIGIN}/api/v1/programs/${clientProgramId}`, {
        method: 'PATCH',
        headers: mutating(headersFor(t.coachA)),
        body: JSON.stringify({ expectedVersion: 1, title: 'Client block', weeks }),
      }),
      ctx(clientProgramId),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: { title: 'Client block', kind: 'client', versionNo: 2 },
    });
  });

  it('invalid body -> 422 with field errors', async () => {
    const template = await newTemplate(headersFor(t.coachA));
    const res = await assign(headersFor(t.coachA), template, body(clientAId, { weekdays: [0, 9] }));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'VALIDATION' } });
  });

  it('client role -> 403 on both endpoints', async () => {
    const template = await newTemplate(headersFor(t.coachA));
    const res = await assign(headersFor(t.clientA), template, body(clientAId));
    expect(res.status).toBe(403);
    expect((await getAssignment(headersFor(t.clientA), clientAId)).status).toBe(403);
  });

  it('coach B gets 404 for an org A client and for an org A template', async () => {
    const own = await newTemplate(headersFor(t.coachB));
    const res = await assign(headersFor(t.coachB), own, body(clientAId));
    expect(res.status).toBe(404);
    expect((await getAssignment(headersFor(t.coachB), clientAId)).status).toBe(404);

    const aTemplate = await newTemplate(headersFor(t.coachA));
    const cross = await assign(headersFor(t.coachB), aTemplate, body(clientAId));
    expect(cross.status).toBe(404);
  });

  it('non-UUID ids -> 404', async () => {
    expect((await assign(headersFor(t.coachA), 'nope', body(clientAId))).status).toBe(404);
    expect((await getAssignment(headersFor(t.coachA), 'nope')).status).toBe(404);
  });
});
