import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { clientGetRoute, clientsPostRoute } from '@/server/routes/clients';
import { inviteDeleteRoute, invitePostRoute } from '@/server/routes/invites';
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
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const createClientVia = async (headers: Headers, email: string) => {
  const res = await api()(clientsPostRoute)(
    new Request(`${ORIGIN}/api/v1/clients`, {
      method: 'POST',
      headers: mutating(headers),
      body: JSON.stringify({ name: 'Ann', email }),
    }),
  );
  return ((await res.json()) as { data: { id: string } }).data.id;
};
const invite = (headers: Headers, id: string) =>
  api()(invitePostRoute)(
    new Request(`${ORIGIN}/api/v1/clients/${id}/invite`, {
      method: 'POST',
      headers: mutating(headers),
    }),
    ctx(id),
  );
const revoke = (headers: Headers, id: string) =>
  api()(inviteDeleteRoute)(
    new Request(`${ORIGIN}/api/v1/clients/${id}/invite`, {
      method: 'DELETE',
      headers: mutating(headers),
    }),
    ctx(id),
  );
const inviteStatus = async (headers: Headers, id: string) => {
  const res = await api()(clientGetRoute)(
    new Request(`${ORIGIN}/api/v1/clients/${id}`, { headers }),
    ctx(id),
  );
  return ((await res.json()) as { data: { inviteStatus: string } }).data.inviteStatus;
};
const inviteExpiry = async (headers: Headers, id: string) => {
  const res = await api()(clientGetRoute)(
    new Request(`${ORIGIN}/api/v1/clients/${id}`, { headers }),
    ctx(id),
  );
  return ((await res.json()) as { data: { inviteExpiresAt: string | null } }).data.inviteExpiresAt;
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

describe('invites API', () => {
  it('issue → 201; email payload has the token, the DB row only the hash; status transitions', async () => {
    const id = await createClientVia(headersFor(t.coachA), 'inv1@example.test');
    expect(await inviteStatus(headersFor(t.coachA), id)).toBe('none');
    const res = await invite(headersFor(t.coachA), id);
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { inviteId: string; expiresAt: string } };
    expect(JSON.stringify(data)).not.toMatch(/token/i);
    const mail = await withSystem(
      (tx) =>
        tx.outboxEmail.findUniqueOrThrow({
          where: { idempotencyKey: `client_invite:${data.inviteId}` },
        }),
      prisma,
    );
    const token = (mail.payloadJson as { token: string }).token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await withSystem(
      (tx) => tx.clientInvite.findUniqueOrThrow({ where: { id: data.inviteId } }),
      prisma,
    );
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await inviteStatus(headersFor(t.coachA), id)).toBe('pending');
    expect(await inviteExpiry(headersFor(t.coachA), id)).toBe(data.expiresAt);
    expect((await revoke(headersFor(t.coachA), id)).status).toBe(200);
    expect(await inviteStatus(headersFor(t.coachA), id)).toBe('none');
    expect(await inviteExpiry(headersFor(t.coachA), id)).toBeNull();
  });

  it("coach B can't issue for an org A client (404)", async () => {
    const id = await createClientVia(headersFor(t.coachA), 'inv2@example.test');
    expect((await invite(headersFor(t.coachB), id)).status).toBe(404);
    expect((await revoke(headersFor(t.coachB), id)).status).toBe(404);
    expect((await invite(headersFor(t.coachA), 'not-a-uuid')).status).toBe(404);
  });

  it('client role → 403', async () => {
    const id = await createClientVia(headersFor(t.coachA), 'inv3@example.test');
    expect((await invite(headersFor(t.clientA), id)).status).toBe(403);
    expect((await revoke(headersFor(t.clientA), id)).status).toBe(403);
  });
});
