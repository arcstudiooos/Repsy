import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import {
  programDraftDeleteRoute,
  programDraftGetRoute,
  programDraftPutRoute,
  programPatchRoute,
  programsPostRoute,
  programVersionGetRoute,
  programVersionsListRoute,
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

const mutating = (headers: Headers, origin: string | null = ORIGIN) => {
  const h = new Headers(headers);
  if (origin) h.set('origin', origin);
  else h.delete('origin');
  h.set('content-type', 'application/json');
  return h;
};
const ctx = (id: string, no?: string) => ({
  params: Promise.resolve<Record<string, string>>(no === undefined ? { id } : { id, no }),
});
const url = (id: string, tail: string) => `${ORIGIN}/api/v1/programs/${id}${tail}`;

const putDraft = (headers: Headers, id: string, body: unknown, origin: string | null = ORIGIN) =>
  api()(programDraftPutRoute)(
    new Request(url(id, '/draft'), {
      method: 'PUT',
      headers: mutating(headers, origin),
      body: JSON.stringify(body),
    }),
    ctx(id),
  );
const getDraft = (headers: Headers, id: string) =>
  api()(programDraftGetRoute)(new Request(url(id, '/draft'), { headers }), ctx(id));
const delDraft = (headers: Headers, id: string) =>
  api()(programDraftDeleteRoute)(
    new Request(url(id, '/draft'), { method: 'DELETE', headers: mutating(headers) }),
    ctx(id),
  );

async function newProgram(): Promise<string> {
  const res = await api()(programsPostRoute)(
    new Request(`${ORIGIN}/api/v1/programs`, {
      method: 'POST',
      headers: mutating(headersFor(t.coachA)),
      body: JSON.stringify({ title: 'P' }),
    }),
  );
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

describe('program drafts API', () => {
  it('PUT / GET / DELETE happy path', async () => {
    const id = await newProgram();
    const h = headersFor(t.coachA);
    expect(await (await getDraft(h, id)).json()).toEqual({ data: null });

    const put = await putDraft(h, id, {
      baseVersionNo: null,
      title: 'Draft',
      weeks: [{ days: [] }],
    });
    expect(put.status).toBe(200);
    const { data } = (await put.json()) as { data: { updatedAt: string } };
    expect(typeof data.updatedAt).toBe('string');

    const got = (await (await getDraft(h, id)).json()) as {
      data: { title: string; weeks: unknown[]; baseVersionNo: number | null };
    };
    expect(got.data).toMatchObject({ title: 'Draft', weeks: [{ days: [] }], baseVersionNo: null });

    expect((await delDraft(h, id)).status).toBe(204);
    expect((await delDraft(h, id)).status).toBe(204);
    expect(await (await getDraft(h, id)).json()).toEqual({ data: null });
  });

  it('PUT validates the body (422) and caps the title', async () => {
    const id = await newProgram();
    const h = headersFor(t.coachA);
    expect((await putDraft(h, id, { baseVersionNo: 0, weeks: [] })).status).toBe(422);
    expect((await putDraft(h, id, { baseVersionNo: null, weeks: 'x' })).status).toBe(422);
    expect(
      (await putDraft(h, id, { baseVersionNo: null, title: 'x'.repeat(121), weeks: [] })).status,
    ).toBe(422);
  });

  it("a coach of org B gets 404 on org A's draft (all methods)", async () => {
    const id = await newProgram();
    await putDraft(headersFor(t.coachA), id, { baseVersionNo: null, weeks: [] });
    const b = headersFor(t.coachB);
    expect((await getDraft(b, id)).status).toBe(404);
    expect((await putDraft(b, id, { baseVersionNo: null, weeks: [] })).status).toBe(404);
    expect((await delDraft(b, id)).status).toBe(404);
  });

  it('a client actor gets 403', async () => {
    const id = await newProgram();
    const c = headersFor(t.clientA);
    expect((await getDraft(c, id)).status).toBe(403);
    expect((await putDraft(c, id, { baseVersionNo: null, weeks: [] })).status).toBe(403);
    expect((await delDraft(c, id)).status).toBe(403);
  });

  it('PUT without Origin -> 403', async () => {
    const id = await newProgram();
    const res = await putDraft(headersFor(t.coachA), id, { baseVersionNo: null, weeks: [] }, null);
    expect(res.status).toBe(403);
  });

  it('versions list and read-by-number; commit clears the draft', async () => {
    const id = await newProgram();
    const h = headersFor(t.coachA);
    const patch = (expectedVersion: number | null, title: string) =>
      api()(programPatchRoute)(
        new Request(url(id, ''), {
          method: 'PATCH',
          headers: mutating(h),
          body: JSON.stringify({
            expectedVersion,
            weeks: [
              {
                days: [
                  { title, exercises: [{ exerciseId: BENCH, sets: [{ reps: 8, loadKg: 60 }] }] },
                ],
              },
            ],
          }),
        }),
        ctx(id),
      );
    await putDraft(h, id, { baseVersionNo: null, weeks: [] });
    expect((await patch(null, 'One')).status).toBe(200);
    expect((await patch(1, 'Two')).status).toBe(200);
    expect(await (await getDraft(h, id)).json()).toEqual({ data: null });

    const list = (await (
      await api()(programVersionsListRoute)(
        new Request(url(id, '/versions'), { headers: h }),
        ctx(id),
      )
    ).json()) as { data: { versionNo: number }[] };
    expect(list.data.map((v) => v.versionNo)).toEqual([2, 1]);

    const v1 = (await (
      await api()(programVersionGetRoute)(
        new Request(url(id, '/versions/1'), { headers: h }),
        ctx(id, '1'),
      )
    ).json()) as { data: { versionNo: number; weeks: { days: { title: string }[] }[] } };
    expect(v1.data.versionNo).toBe(1);
    expect(v1.data.weeks[0]?.days[0]?.title).toBe('One');

    const missing = await api()(programVersionGetRoute)(
      new Request(url(id, '/versions/9'), { headers: h }),
      ctx(id, '9'),
    );
    expect(missing.status).toBe(404);
    const bad = await api()(programVersionGetRoute)(
      new Request(url(id, '/versions/abc'), { headers: h }),
      ctx(id, 'abc'),
    );
    expect(bad.status).toBe(404);
    const other = await api()(programVersionsListRoute)(
      new Request(url(id, '/versions'), { headers: headersFor(t.coachB) }),
      ctx(id),
    );
    expect(other.status).toBe(404);
  });
});
