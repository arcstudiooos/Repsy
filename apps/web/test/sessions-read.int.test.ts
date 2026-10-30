import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { sessionsListRoute } from '@/server/routes/workoutSessions';
import {
  createUser,
  headersFor,
  seedTwoTenants,
  TEST_SECRET,
  type TwoTenants,
} from './harness/tenants';
import { linkClient, seedAssignment, type SeededAssignment } from './harness/sessions';
import { withSystem } from '@kinetic/db';

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
let sibling: SeededAssignment;
let dualB: SeededAssignment;

const api = () =>
  createApiHandler({
    auth,
    prisma,
    secret: TEST_SECRET,
    appBaseUrl: ORIGIN,
    limiter: new InMemoryRateLimiter({ capacity: 1000, refillPerSecond: 1000 }),
  });

const list = (headers: Headers, qs = '') =>
  api()(sessionsListRoute)(new Request(`${ORIGIN}/api/v1/sessions${qs}`, { headers }));
const ids = async (res: Response) =>
  ((await res.json()) as { data: { id: string; clientId: string }[] }).data;

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
  const clientA = await linkClient(prisma, t.orgA.id, t.clientA.id, t.coachA.id);
  a = await seedAssignment(prisma, t.orgA.id, clientA, t.coachA.id, { days: 3 });
  // A second client in org A.
  const other = await createUser(prisma, auth, 'sibling');
  await withSystem(
    (tx) =>
      tx.membership.create({
        data: { userId: other.id, organizationId: t.orgA.id, role: 'client' },
      }),
    prisma,
  );
  const siblingId = await linkClient(prisma, t.orgA.id, other.id, t.coachA.id);
  sibling = await seedAssignment(prisma, t.orgA.id, siblingId, t.coachA.id);
  // The dual-role user is a client of org B.
  const dualClient = await linkClient(prisma, t.orgB.id, t.dualRoleUser.id, t.coachB.id);
  dualB = await seedAssignment(prisma, t.orgB.id, dualClient, t.coachB.id, { days: 1 });
});
afterAll(async () => {
  await drop();
  await prisma.$disconnect();
});

describe('GET /api/v1/sessions', () => {
  it('a client lists only their own sessions; another clientId in the query is ignored', async () => {
    const own = await list(headersFor(t.clientA, t.orgA.id));
    expect(own.status).toBe(200);
    expect((await ids(own)).map((s) => s.id)).toEqual(a.sessionIds);

    const sneaky = await list(headersFor(t.clientA, t.orgA.id), `?clientId=${sibling.clientId}`);
    expect((await ids(sneaky)).map((s) => s.clientId)).toEqual([
      a.clientId,
      a.clientId,
      a.clientId,
    ]);
  });

  it('a coach lists a client of their org; coach B gets 404 for an org A client', async () => {
    const coach = await list(headersFor(t.coachA, t.orgA.id), `?clientId=${a.clientId}`);
    expect((await ids(coach)).length).toBe(3);
    const cross = await list(headersFor(t.coachB, t.orgB.id), `?clientId=${a.clientId}`);
    expect(cross.status).toBe(404);
  });

  it('a dual-role user acting as client of B sees only B sessions; as owner of A they need a clientId', async () => {
    const asClient = await list(headersFor(t.dualRoleUser, t.orgB.id));
    expect((await ids(asClient)).map((s) => s.id)).toEqual(dualB.sessionIds);
    const asOwner = await list(headersFor(t.dualRoleUser, t.orgA.id));
    expect(asOwner.status).toBe(404);
  });

  it('invalid scope → 422; past is empty before anything is finished', async () => {
    const bad = await list(headersFor(t.clientA, t.orgA.id), '?scope=everything');
    expect(bad.status).toBe(422);
    const past = await list(headersFor(t.clientA, t.orgA.id), '?scope=past');
    expect(await ids(past)).toEqual([]);
  });

  it('a malformed cursor is 422; a client-role user without a Client row gets 404', async () => {
    const bad = await list(headersFor(t.clientA, t.orgA.id), '?cursor=garbage');
    expect(bad.status).toBe(422);
    const orphan = await createUser(prisma, auth, 'orphan');
    await withSystem(
      (tx) =>
        tx.membership.create({
          data: { userId: orphan.id, organizationId: t.orgA.id, role: 'client' },
        }),
      prisma,
    );
    expect((await list(headersFor(orphan, t.orgA.id))).status).toBe(404);
  });
});
