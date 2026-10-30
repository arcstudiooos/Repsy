import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { issueDueCheckins } from '@kinetic/core';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler, type RouteDef } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import {
  checkinDraftPutRoute,
  checkinGetRoute,
  checkinsListRoute,
  checkinSubmitRoute,
  checkinTemplateGetRoute,
  checkinTemplatePatchRoute,
  clientCheckinSchedulePutRoute,
} from '@/server/routes/checkins';
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
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
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

describe('check-in routes (S4-1)', () => {
  it('template, schedule, issue, draft, submit (idempotent), coach view with activity', async () => {
    const tpl = await call(checkinTemplateGetRoute, asCoachA(), '/checkin-template', 'GET');
    expect(tpl.status).toBe(200);
    expect((await tpl.json()).data.questions).toHaveLength(6);
    const edited = await call(checkinTemplatePatchRoute, asCoachA(), '/checkin-template', 'PATCH', {
      title: 'Sunday check-in',
    });
    expect((await edited.json()).data.title).toBe('Sunday check-in');

    // Today's weekday in UTC (the client's zone).
    const weekday = new Date().getUTCDay() || 7;
    const sched = await call(
      clientCheckinSchedulePutRoute,
      asCoachA(),
      `/clients/${clientA}/checkin-schedule`,
      'PUT',
      { checkinWeekday: weekday },
      clientA,
    );
    expect(sched.status).toBe(200);
    // Issue as the worker would, late enough in the day.
    const issueAt = new Date();
    issueAt.setUTCHours(Math.max(issueAt.getUTCHours(), 7));
    await withTenant(t.orgA.id, (tx) => issueDueCheckins(tx, issueAt), prisma);

    const list = await call(checkinsListRoute, asClientA(), '/checkins', 'GET');
    const [checkin] = (await list.json()).data;
    expect(checkin).toMatchObject({ title: 'Sunday check-in', submittedAt: null });

    const draft = await call(
      checkinDraftPutRoute,
      asClientA(),
      `/checkins/${checkin.id}/draft`,
      'PUT',
      { answers: { energy: 2 } },
      checkin.id,
    );
    expect(draft.status).toBe(200);

    const body = { answers: { energy: 4, notes: 'Fine' }, idempotencyKey: 'submit-key-1' };
    const submit = () =>
      call(
        checkinSubmitRoute,
        asClientA(),
        `/checkins/${checkin.id}/submit`,
        'POST',
        body,
        checkin.id,
      );
    const first = await submit();
    expect(first.status).toBe(200);
    expect((await (await submit()).json()).data).toEqual((await first.json()).data);
    const again = await call(
      checkinSubmitRoute,
      asClientA(),
      `/checkins/${checkin.id}/submit`,
      'POST',
      { idempotencyKey: 'submit-key-2' },
      checkin.id,
    );
    expect(again.status).toBe(409);

    const coachView = await call(
      checkinGetRoute,
      asCoachA(),
      `/checkins/${checkin.id}`,
      'GET',
      undefined,
      checkin.id,
    );
    const json = await coachView.json();
    expect(json.data).toMatchObject({
      status: 'submitted',
      answers: { energy: 4, notes: 'Fine' },
      draft: null,
    });
    expect(json.meta.activity).toMatchObject({ total: 0 });
    expect(
      await withSystem(
        (tx) =>
          tx.auditEvent.count({ where: { objectId: checkin.id, action: 'checkin.submitted' } }),
        prisma,
      ),
    ).toBe(1);
  });

  it('404 cross-org, 403 for the wrong role, 422 on a bad weekday', async () => {
    const [c] = await withSystem((tx) => tx.checkin.findMany({ take: 1 }), prisma);
    expect(
      (await call(checkinGetRoute, asCoachB(), `/checkins/${c!.id}`, 'GET', undefined, c!.id))
        .status,
    ).toBe(404);
    expect(
      (await call(checkinsListRoute, asCoachB(), `/checkins?clientId=${clientA}`, 'GET')).status,
    ).toBe(404);
    expect(
      (await call(checkinTemplateGetRoute, asClientA(), '/checkin-template', 'GET')).status,
    ).toBe(403);
    expect(
      (
        await call(
          checkinSubmitRoute,
          asCoachA(),
          `/checkins/${c!.id}/submit`,
          'POST',
          { idempotencyKey: 'coach-key-1' },
          c!.id,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          clientCheckinSchedulePutRoute,
          asCoachA(),
          `/clients/${clientA}/checkin-schedule`,
          'PUT',
          { checkinWeekday: 9 },
          clientA,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await call(
          clientCheckinSchedulePutRoute,
          asCoachB(),
          `/clients/${clientA}/checkin-schedule`,
          'PUT',
          { checkinWeekday: 1 },
          clientA,
        )
      ).status,
    ).toBe(404);
  });
});
