import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler, type RouteDef } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import {
  clientThreadRoute,
  messagesListRoute,
  messagesPostRoute,
  threadMeRoute,
  threadsListRoute,
} from '@/server/routes/messages';
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
  method: 'GET' | 'POST',
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
afterEach(() => vi.restoreAllMocks());

describe('message routes (S4-4)', () => {
  it('client and coach exchange messages; a retry is idempotent; the body is never logged', async () => {
    const out: string[] = [];
    for (const stream of [process.stdout, process.stderr]) {
      vi.spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
        out.push(String(chunk));
        return true;
      });
    }
    const secret = 'my private training note';
    const me = await (await call(threadMeRoute, asClientA(), '/threads/me', 'GET')).json();
    const threadId = me.data.id as string;
    const coachThread = await (
      await call(
        clientThreadRoute,
        asCoachA(),
        `/clients/${clientA}/thread`,
        'GET',
        undefined,
        clientA,
      )
    ).json();
    expect(coachThread.data.id).toBe(threadId);

    const key = randomUUID();
    const send = () =>
      call(
        messagesPostRoute,
        asClientA(),
        `/threads/${threadId}/messages`,
        'POST',
        { body: secret, clientMessageId: key },
        threadId,
      );
    const first = await send();
    expect(first.status).toBe(201);
    const second = await send();
    expect((await second.json()).data.id).toBe((await first.json()).data.id);
    const tooLong = await call(
      messagesPostRoute,
      asClientA(),
      `/threads/${threadId}/messages`,
      'POST',
      { body: `${secret} ${'x'.repeat(4001)}` },
      threadId,
    );
    expect(tooLong.status).toBe(422);

    const inbox = await (await call(threadsListRoute, asCoachA(), '/threads', 'GET')).json();
    expect(inbox.data[0]).toMatchObject({ id: threadId, unread: 1 });
    const page = await (
      await call(
        messagesListRoute,
        asCoachA(),
        `/threads/${threadId}/messages`,
        'GET',
        undefined,
        threadId,
      )
    ).json();
    expect(page.data).toHaveLength(1);
    expect(page.meta).toEqual({ nextCursor: null });
    const after = await (await call(threadsListRoute, asCoachA(), '/threads', 'GET')).json();
    expect(after.data[0].unread).toBe(0);

    expect(out.join('')).not.toContain(secret);
  });

  it('404 cross-org; clients cannot open the inbox; archived clients cannot post', async () => {
    const me = await (await call(threadMeRoute, asClientA(), '/threads/me', 'GET')).json();
    const threadId = me.data.id as string;
    expect(
      (
        await call(
          messagesListRoute,
          asCoachB(),
          `/threads/${threadId}/messages`,
          'GET',
          undefined,
          threadId,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          clientThreadRoute,
          asCoachB(),
          `/clients/${clientA}/thread`,
          'GET',
          undefined,
          clientA,
        )
      ).status,
    ).toBe(404);
    expect((await call(threadsListRoute, asClientA(), '/threads', 'GET')).status).toBe(403);
    await withSystem(
      (tx) => tx.client.update({ where: { id: clientA }, data: { status: 'archived' } }),
      prisma,
    );
    const res = await call(
      messagesPostRoute,
      asCoachA(),
      `/threads/${threadId}/messages`,
      'POST',
      { body: 'hi' },
      threadId,
    );
    expect(res.status).toBe(409);
  });
});
