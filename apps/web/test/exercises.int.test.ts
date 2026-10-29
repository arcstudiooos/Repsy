import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { exercisesListRoute, exercisesPostRoute } from '@/server/routes/exercises';
import { seedTwoTenants, headersFor, TEST_SECRET, type TwoTenants } from './harness/tenants';

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

const list = (headers: Headers, qs = '') =>
  api()(exercisesListRoute)(new Request(`${ORIGIN}/api/v1/exercises${qs}`, { headers }));
const post = (headers: Headers, body: unknown) =>
  api()(exercisesPostRoute)(
    new Request(`${ORIGIN}/api/v1/exercises`, {
      method: 'POST',
      headers: mutating(headers),
      body: JSON.stringify(body),
    }),
  );

const body = {
  name: 'Sandbag Shouldering',
  equipment: 'Other',
  muscleGroup: 'Full body',
  movementType: 'Hinge',
  trackingType: 'reps_load',
};

type Listed = {
  data: { id: string; name: string; isGlobal: boolean }[];
  meta: { nextCursor: string | null };
};

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('exercises API', () => {
  it('coach creates (201), sees it plus globals; org B sees globals but not the custom one', async () => {
    const res = await post(headersFor(t.coachA), body);
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { id: string; isGlobal: boolean } };
    expect(data.isGlobal).toBe(false);

    const a = (await (await list(headersFor(t.coachA), '?q=sandbag')).json()) as Listed;
    expect(a.data.map((e) => e.id)).toEqual([data.id]);
    const b = (await (await list(headersFor(t.coachB), '?q=sandbag')).json()) as Listed;
    expect(b.data).toEqual([]);
    const g = (await (await list(headersFor(t.coachB), '?q=plank')).json()) as Listed;
    expect(g.data.map((e) => e.name).sort()).toEqual(['Plank', 'Side Plank']);
    expect(g.data.every((e) => e.isGlobal)).toBe(true);

    const audits = await withSystem(
      (tx) => tx.auditEvent.findMany({ where: { objectId: data.id, action: 'exercise.created' } }),
      prisma,
    );
    expect(audits).toHaveLength(1);
  });

  it('first page is 50 with a cursor that leads to the rest', async () => {
    const first = (await (await list(headersFor(t.coachA))).json()) as Listed;
    expect(first.data).toHaveLength(50);
    expect(first.meta.nextCursor).not.toBeNull();
    const second = (await (
      await list(headersFor(t.coachA), `?cursor=${first.meta.nextCursor}`)
    ).json()) as Listed;
    expect(second.data.length).toBeGreaterThan(0);
    const ids = new Set([...first.data, ...second.data].map((e) => e.id));
    expect(ids.size).toBe(first.data.length + second.data.length);
  });

  it('validation → 422; duplicate name → 409 CONFLICT; unsafe media url → 422', async () => {
    expect((await post(headersFor(t.coachA), { ...body, name: '' })).status).toBe(422);
    expect((await post(headersFor(t.coachA), { ...body, trackingType: 'nope' })).status).toBe(422);
    const media = (mediaUrl: string) =>
      post(headersFor(t.coachA), { ...body, name: 'Media', mediaUrl });
    expect((await media('javascript:alert(1)')).status).toBe(422);
    expect((await media('http://e.test/a')).status).toBe(422);
    const dup = await post(headersFor(t.coachA), { ...body, name: 'SANDBAG shouldering' });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: { code: 'CONFLICT' } });
    expect((await list(headersFor(t.coachA), '?trackingType=nope')).status).toBe(422);
    expect((await list(headersFor(t.coachA), `?q=${'x'.repeat(101)}`)).status).toBe(422);
  });

  it('organizationId in POST body is ignored', async () => {
    const res = await post(headersFor(t.coachB), {
      ...body,
      name: 'Bee Press',
      organizationId: t.orgA.id,
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { id: string } };
    const row = await withSystem(
      (tx) => tx.exercise.findUniqueOrThrow({ where: { id: data.id } }),
      prisma,
    );
    expect(row.organizationId).toBe(t.orgB.id);
    const a = (await (await list(headersFor(t.coachA), '?q=bee')).json()) as Listed;
    expect(a.data).toEqual([]);
  });

  it('client role → 403', async () => {
    expect((await list(headersFor(t.clientA))).status).toBe(403);
    expect((await post(headersFor(t.clientA), body)).status).toBe(403);
  });
});
