import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler, type RouteDef } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import {
  reviewFlagPatchRoute,
  reviewFlagPostRoute,
  reviewFlagsListRoute,
} from '@/server/routes/reviewFlags';
import { headersFor, seedTwoTenants, TEST_SECRET, type TwoTenants } from './harness/tenants';
import { linkClient } from './harness/sessions';

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
let clientA: string;

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
const asCoachB = () => headersFor(t.coachB, t.orgB.id);
const asClientA = () => headersFor(t.clientA, t.orgA.id);

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
  clientA = await linkClient(prisma, t.orgA.id, t.clientA.id, t.coachA.id);
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('review-flag routes (S4-3)', () => {
  it('follow-up → list → resolve without a reason is 422, with one 200; audited', async () => {
    const created = await call(reviewFlagPostRoute, asCoachA(), '/review-flags', 'POST', {
      clientId: clientA,
      title: 'Check form video',
    });
    expect(created.status).toBe(201);
    const flag = (await created.json()).data;
    const list = await (
      await call(reviewFlagsListRoute, asCoachA(), '/review-flags', 'GET')
    ).json();
    expect(list.data.map((f: { id: string }) => f.id)).toEqual([flag.id]);

    const patch = (body: unknown) =>
      call(reviewFlagPatchRoute, asCoachA(), `/review-flags/${flag.id}`, 'PATCH', body, flag.id);
    const noReason = await patch({ action: 'resolve', reason: '' });
    expect(noReason.status).toBe(422);
    expect((await noReason.json()).error.fieldErrors).toEqual({ reason: ['Add a reason.'] });
    const ok = await patch({ action: 'resolve', reason: 'Watched it' });
    expect((await ok.json()).data).toMatchObject({
      state: 'resolved',
      resolutionReason: 'Watched it',
    });
    expect(
      await withSystem(
        (tx) =>
          tx.auditEvent.count({ where: { objectId: flag.id, action: 'review_flag.resolved' } }),
        prisma,
      ),
    ).toBe(1);
    expect((await patch({ action: 'snooze', days: 5 })).status).toBe(409);
  });

  it('404 cross-org, 403 for clients, 422 on an unknown action', async () => {
    const [flag] = await withSystem((tx) => tx.reviewFlag.findMany({ take: 1 }), prisma);
    expect(
      (
        await call(
          reviewFlagPatchRoute,
          asCoachB(),
          `/review-flags/${flag!.id}`,
          'PATCH',
          { action: 'reopen' },
          flag!.id,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(reviewFlagPostRoute, asCoachB(), '/review-flags', 'POST', {
          clientId: clientA,
          title: 'x',
        })
      ).status,
    ).toBe(404);
    expect((await call(reviewFlagsListRoute, asClientA(), '/review-flags', 'GET')).status).toBe(
      403,
    );
    expect(
      (
        await call(
          reviewFlagPatchRoute,
          asCoachA(),
          `/review-flags/${flag!.id}`,
          'PATCH',
          { action: 'archive' },
          flag!.id,
        )
      ).status,
    ).toBe(422);
  });
});
