import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import {
  programGetRoute,
  programPatchRoute,
  programsListRoute,
  programsPostRoute,
} from '@/server/routes/programs';
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

const list = (headers: Headers, qs = '') =>
  api()(programsListRoute)(new Request(`${ORIGIN}/api/v1/programs${qs}`, { headers }));
const post = (headers: Headers, body: unknown) =>
  api()(programsPostRoute)(
    new Request(`${ORIGIN}/api/v1/programs`, {
      method: 'POST',
      headers: mutating(headers),
      body: JSON.stringify(body),
    }),
  );
const get = (headers: Headers, id: string) =>
  api()(programGetRoute)(new Request(`${ORIGIN}/api/v1/programs/${id}`, { headers }), ctx(id));
const patch = (headers: Headers, id: string, body: unknown) =>
  api()(programPatchRoute)(
    new Request(`${ORIGIN}/api/v1/programs/${id}`, {
      method: 'PATCH',
      headers: mutating(headers),
      body: JSON.stringify(body),
    }),
    ctx(id),
  );

const weeks = (title: string) => [
  {
    days: [
      { title, exercises: [{ exerciseId: BENCH, sets: [{ reps: 8, loadKg: 60 }] }] },
      { title: 'Day 2', exercises: [{ exerciseId: BENCH, sets: [{ reps: 5 }] }] },
    ],
  },
];

type Detail = {
  data: {
    id: string;
    title: string;
    versionNo: number | null;
    weeks: { days: { title: string }[] }[];
  };
};

async function newProgram(title = 'P'): Promise<string> {
  const res = await post(headersFor(t.coachA), { title });
  return ((await res.json()) as { data: { id: string } }).data.id;
}

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('programs API', () => {
  it('create (201), list, commit via PATCH, read back', async () => {
    const created = await post(headersFor(t.coachA), { title: 'Strength block' });
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: { id: string; versionNo: number | null } };
    expect(data.versionNo).toBeNull();

    const listed = (await (await list(headersFor(t.coachA))).json()) as {
      data: { id: string }[];
      meta: { nextCursor: string | null };
    };
    expect(listed.data.map((p) => p.id)).toContain(data.id);
    expect(listed.meta.nextCursor).toBeNull();

    const res = await patch(headersFor(t.coachA), data.id, {
      expectedVersion: null,
      weeks: weeks('Push'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Detail;
    expect(body.data.versionNo).toBe(1);
    expect(body.data.weeks[0]?.days[0]?.title).toBe('Push');

    const read = (await (await get(headersFor(t.coachA), data.id)).json()) as {
      data: { versionNo: number; daysPerWeek: number };
    };
    expect(read.data).toMatchObject({ versionNo: 1, daysPerWeek: 2 });
  });

  it('stale expectedVersion -> 409 CONFLICT with details.currentVersionNo', async () => {
    const id = await newProgram();
    await patch(headersFor(t.coachA), id, { expectedVersion: null, weeks: weeks('A') });
    const res = await patch(headersFor(t.coachA), id, {
      expectedVersion: null,
      weeks: weeks('B'),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: 'CONFLICT', details: { currentVersionNo: 1 } },
    });
  });

  it('two concurrent PATCHes with the same expectedVersion: one 200, one 409, nothing overwritten', async () => {
    const id = await newProgram();
    await patch(headersFor(t.coachA), id, { expectedVersion: null, weeks: weeks('Base') });
    const [r1, r2] = await Promise.all([
      patch(headersFor(t.coachA), id, { expectedVersion: 1, weeks: weeks('One') }),
      patch(headersFor(t.coachA), id, { expectedVersion: 1, weeks: weeks('Two') }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const winner = r1.status === 200 ? 'One' : 'Two';
    const loser = await (r1.status === 409 ? r1 : r2).json();
    expect(loser).toMatchObject({ error: { details: { currentVersionNo: 2 } } });

    const versions = await withSystem(
      (tx) =>
        tx.programVersion.findMany({ where: { programId: id }, orderBy: { versionNo: 'asc' } }),
      prisma,
    );
    expect(versions.map((v) => v.versionNo)).toEqual([1, 2]);
    const read = (await (await get(headersFor(t.coachA), id)).json()) as Detail;
    expect(read.data.versionNo).toBe(2);
    expect(read.data.weeks[0]?.days[0]?.title).toBe(winner);
  });

  it('title-only PATCH renames without a commit; empty PATCH -> 422', async () => {
    const id = await newProgram('Old');
    const res = await patch(headersFor(t.coachA), id, { expectedVersion: null, title: 'New' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { title: 'New', versionNo: null } });
    expect((await patch(headersFor(t.coachA), id, { expectedVersion: null })).status).toBe(422);
  });

  it('a failed commit rolls back a same-request rename', async () => {
    const id = await newProgram('Keep');
    const res = await patch(headersFor(t.coachA), id, {
      expectedVersion: 7,
      title: 'Renamed',
      weeks: weeks('X'),
    });
    expect(res.status).toBe(409);
    const read = (await (await get(headersFor(t.coachA), id)).json()) as Detail;
    expect(read.data.title).toBe('Keep');
  });

  it('validation: uneven weeks -> 422 with fieldErrors.weeks; bad body -> 422', async () => {
    const id = await newProgram();
    const full = weeks('A')[0]!;
    const uneven = [full, { days: [full.days[0]] }];
    const res = await patch(headersFor(t.coachA), id, { expectedVersion: null, weeks: uneven });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { fieldErrors: Record<string, string[]> } };
    expect(body.error.fieldErrors.weeks?.length).toBeGreaterThan(0);
    expect((await post(headersFor(t.coachA), { title: '' })).status).toBe(422);
  });

  it('cross-tenant: other org gets 404 on read and patch; list is scoped; ids are UUID-guarded', async () => {
    const id = await newProgram('Mine');
    expect((await get(headersFor(t.coachB), id)).status).toBe(404);
    expect(
      (await patch(headersFor(t.coachB), id, { expectedVersion: null, weeks: weeks('x') })).status,
    ).toBe(404);
    const bList = (await (await list(headersFor(t.coachB))).json()) as { data: { id: string }[] };
    expect(bList.data.map((p) => p.id)).not.toContain(id);
    expect((await get(headersFor(t.coachA), 'not-a-uuid')).status).toBe(404);
    expect((await get(headersFor(t.coachA), '%E0%A4%A')).status).toBe(404);
  });

  it('a custom exercise of another org -> 404; a client member is forbidden', async () => {
    const foreign = await withSystem(
      (tx) =>
        tx.exercise.create({
          data: {
            organizationId: t.orgB.id,
            name: 'B only',
            equipment: 'x',
            muscleGroup: 'x',
            movementType: 'x',
            trackingType: 'reps_load',
          },
        }),
      prisma,
    );
    const id = await newProgram();
    const bad = [
      { days: [{ title: 'T', exercises: [{ exerciseId: foreign.id, sets: [{ reps: 5 }] }] }] },
    ];
    expect(
      (await patch(headersFor(t.coachA), id, { expectedVersion: null, weeks: bad })).status,
    ).toBe(404);
    expect((await list(headersFor(t.clientA))).status).toBe(403);
    expect((await post(headersFor(t.clientA), { title: 'x' })).status).toBe(403);
  });
});
