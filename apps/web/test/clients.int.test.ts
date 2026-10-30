import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import {
  clientGetRoute,
  clientPatchRoute,
  clientsListRoute,
  clientsPostRoute,
} from '@/server/routes/clients';
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
  api()(clientsListRoute)(new Request(`${ORIGIN}/api/v1/clients${qs}`, { headers }));
const post = (headers: Headers, body: unknown) =>
  api()(clientsPostRoute)(
    new Request(`${ORIGIN}/api/v1/clients`, {
      method: 'POST',
      headers: mutating(headers),
      body: JSON.stringify(body),
    }),
  );
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (headers: Headers, id: string, rawPath = id) =>
  api()(clientGetRoute)(new Request(`${ORIGIN}/api/v1/clients/${rawPath}`, { headers }), ctx(id));
const patch = (headers: Headers, id: string, body: unknown) =>
  api()(clientPatchRoute)(
    new Request(`${ORIGIN}/api/v1/clients/${id}`, {
      method: 'PATCH',
      headers: mutating(headers),
      body: JSON.stringify(body),
    }),
    ctx(id),
  );

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('clients API', () => {
  it('coach creates (201) and lists; audit event recorded', async () => {
    const res = await post(headersFor(t.coachA), {
      name: 'Ann',
      email: 'Ann@Example.test',
      goals: 'x',
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { id: string; email: string; status: string } };
    expect(data).toMatchObject({ email: 'ann@example.test', status: 'invited' });
    const listed = await list(headersFor(t.coachA));
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      data: { id: string }[];
      meta: { nextCursor: string | null };
    };
    expect(body.data.map((c) => c.id)).toContain(data.id);
    expect(body.meta.nextCursor).toBeNull();
    const audits = await withSystem(
      (tx) => tx.auditEvent.findMany({ where: { objectId: data.id, action: 'client.created' } }),
      prisma,
    );
    expect(audits).toHaveLength(1);
  });

  it('duplicate email → 409 EMAIL_TAKEN; bad body → 422', async () => {
    await post(headersFor(t.coachA), { name: 'Dup', email: 'dup@example.test' });
    const res = await post(headersFor(t.coachA), { name: 'Dup2', email: 'DUP@example.test' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'EMAIL_TAKEN' } });
    expect((await post(headersFor(t.coachA), { name: '', email: 'nope' })).status).toBe(422);
    expect((await list(headersFor(t.coachA), '?q=' + 'x'.repeat(101))).status).toBe(422);
  });

  it('coach B GET of an org A client → 404', async () => {
    const created = await post(headersFor(t.coachA), {
      name: 'Secret',
      email: 'secret@example.test',
    });
    const { data } = (await created.json()) as { data: { id: string } };
    const res = await get(headersFor(t.coachB), data.id);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain('Secret');
    expect((await get(headersFor(t.coachB, t.orgA.id), data.id)).status).toBe(404);
    expect((await patch(headersFor(t.coachB), data.id, { name: 'Pwned' })).status).toBe(404);
    expect((await get(headersFor(t.coachA), data.id)).status).toBe(200);
    expect((await get(headersFor(t.coachA), 'not-a-uuid')).status).toBe(404);
    // malformed percent-encoding must be a 404, never a 500 (no URL parsing in the handler)
    expect((await get(headersFor(t.coachA), '%E0%A4%A')).status).toBe(404);
    expect((await patch(headersFor(t.coachA), '%E0%A4%A', { name: 'x' })).status).toBe(404);
  });

  it('client role GET /clients → 403', async () => {
    expect((await list(headersFor(t.clientA))).status).toBe(403);
    expect((await post(headersFor(t.clientA), { name: 'X', email: 'x@example.test' })).status).toBe(
      403,
    );
  });

  it('organizationId in POST body is ignored', async () => {
    const res = await post(headersFor(t.coachB), {
      name: 'Bee',
      email: 'bee@example.test',
      organizationId: t.orgA.id,
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { id: string } };
    const row = await withSystem(
      (tx) => tx.client.findUniqueOrThrow({ where: { id: data.id } }),
      prisma,
    );
    expect(row.organizationId).toBe(t.orgB.id);
  });

  it('PATCH status archived frees a slot', async () => {
    await withSystem(
      (tx) => tx.organization.update({ where: { id: t.orgB.id }, data: { activeClientLimit: 1 } }),
      prisma,
    );
    await withSystem(
      (tx) => tx.client.deleteMany({ where: { organizationId: t.orgB.id } }),
      prisma,
    );
    const first = await post(headersFor(t.coachB), { name: 'One', email: 'one@example.test' });
    const { data } = (await first.json()) as { data: { id: string } };
    const blocked = await post(headersFor(t.coachB), { name: 'Two', email: 'two@example.test' });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: { code: 'CLIENT_LIMIT_REACHED' } });
    const archived = await patch(headersFor(t.coachB), data.id, { status: 'archived' });
    expect(archived.status).toBe(200);
    expect(((await archived.json()) as { data: { status: string } }).data.status).toBe('archived');
    expect(
      (await post(headersFor(t.coachB), { name: 'Two', email: 'two@example.test' })).status,
    ).toBe(201);
    const audits = await withSystem(
      (tx) => tx.auditEvent.count({ where: { objectId: data.id, action: 'client.updated' } }),
      prisma,
    );
    expect(audits).toBe(1);
  });

  it('PATCH invited -> active is 409 CONFLICT (a client activates only by accepting an invite)', async () => {
    const res = await post(headersFor(t.coachA), { name: 'Never', email: 'never@example.test' });
    const { data } = (await res.json()) as { data: { id: string } };
    const bad = await patch(headersFor(t.coachA), data.id, { status: 'active' });
    expect(bad.status).toBe(409);
    expect(await bad.json()).toMatchObject({ error: { code: 'CONFLICT' } });
    const read = (await (await get(headersFor(t.coachA), data.id)).json()) as {
      data: { status: string };
    };
    expect(read.data.status).toBe('invited');
  });

  it('empty PATCH changes nothing: no write, no audit (follow-up)', async () => {
    const res = await post(headersFor(t.coachA), { name: 'Still', email: 'still@example.test' });
    const { data } = (await res.json()) as { data: { id: string } };
    const before = await withSystem(
      (tx) => tx.client.findUniqueOrThrow({ where: { id: data.id } }),
      prisma,
    );
    const empty = await patch(headersFor(t.coachA), data.id, { organizationId: t.orgB.id });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ data: { id: data.id, name: 'Still' } });
    const after = await withSystem(
      (tx) => tx.client.findUniqueOrThrow({ where: { id: data.id } }),
      prisma,
    );
    expect(after.updatedAt).toEqual(before.updatedAt);
    const audits = await withSystem(
      (tx) => tx.auditEvent.count({ where: { objectId: data.id, action: 'client.updated' } }),
      prisma,
    );
    expect(audits).toBe(0);
    // A cross-tenant empty PATCH is still a 404, never an existence leak.
    expect((await patch(headersFor(t.coachB), data.id, {})).status).toBe(404);
  });

  it('PATCH audit objectId is the canonical client id, not the raw URL segment', async () => {
    const res = await post(headersFor(t.coachA), { name: 'Upper', email: 'upper@example.test' });
    const { data } = (await res.json()) as { data: { id: string } };
    const shouted = data.id.toUpperCase();
    expect((await patch(headersFor(t.coachA), shouted, { name: 'Upper Case' })).status).toBe(200);
    const audits = await withSystem(
      (tx) =>
        tx.auditEvent.findMany({
          where: { action: 'client.updated', objectId: { in: [data.id, shouted] } },
          select: { objectId: true },
        }),
      prisma,
    );
    expect(audits).toEqual([{ objectId: data.id }]);
  });
});
