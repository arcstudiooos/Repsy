import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claimExport, completeExport } from '@repsy/core';
import { withTenant, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import { createFsStorage } from '@repsy/storage';
import { createAuth, type Auth } from '@/lib/auth';
import { createApiHandler, type RouteDef } from '@/server/api';
import { signExportLink } from '@/server/exportLinks';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import {
  exportFileRoute,
  exportLinksRoute,
  exportsListRoute,
  exportsPostRoute,
  exportStorage,
} from '@/server/routes/exports';
import { headersFor, seedTwoTenants, TEST_SECRET, type TwoTenants } from './harness/tenants';
import { linkClient, seedAssignment } from './harness/sessions';

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
let dir: string;

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
  url: string,
  method: 'GET' | 'POST',
  body?: unknown,
  params: Record<string, string> = {},
) => {
  const h = new Headers(headers);
  if (method !== 'GET') h.set('origin', ORIGIN);
  if (body !== undefined) h.set('content-type', 'application/json');
  return api()(route)(
    new Request(`${ORIGIN}${url}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve(params) },
  );
};
const asCoachA = () => headersFor(t.coachA, t.orgA.id);
const asClientA = () => headersFor(t.clientA, t.orgA.id);

beforeAll(async () => {
  ({ prisma, authPrisma, drop } = await createTestDb());
  auth = createAuth({ prisma, authPrisma, env });
  t = await seedTwoTenants(prisma, auth);
  const clientA = await linkClient(prisma, t.orgA.id, t.clientA.id, t.coachA.id);
  await seedAssignment(prisma, t.orgA.id, clientA, t.coachA.id, { days: 2 });
  dir = await mkdtemp(join(tmpdir(), 'repsy-web-exports-'));
  exportStorage.set(createFsStorage(dir));
  process.env.BETTER_AUTH_SECRET ??= TEST_SECRET;
});
afterAll(async () => {
  exportStorage.set(undefined);
  await rm(dir, { recursive: true, force: true });
  await drop();
  await prisma.$disconnect();
});

describe('export routes (S5-2)', () => {
  it('client requests, the worker builds, links download only for the requester', async () => {
    const res = await call(exportsPostRoute, asClientA(), '/api/v1/exports', 'POST', {
      scope: 'client_self',
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe(202);
    const job = (await res.json()).data;
    expect(job.status).toBe('queued');

    // The worker's steps, inline.
    const claimed = await withTenant(
      t.orgA.id,
      (tx) => claimExport(tx, job.id, new Date()),
      prisma,
    );
    await completeExport(
      (fn) => withTenant(t.orgA.id, fn, prisma),
      t.orgA.id,
      claimed!,
      createFsStorage(dir),
      new Date(),
    );

    const list = await (await call(exportsListRoute, asClientA(), '/api/v1/exports', 'GET')).json();
    expect(list.data[0]).toMatchObject({ id: job.id, status: 'done' });
    const links = (
      await (
        await call(
          exportLinksRoute,
          asClientA(),
          `/api/v1/exports/${job.id}/links`,
          'POST',
          undefined,
          { id: job.id },
        )
      ).json()
    ).data;
    const sessions = links.find((l: { name: string }) => l.name === 'sessions.csv');
    const url = new URL(sessions.url, ORIGIN);
    const params = { id: job.id, name: 'sessions.csv' };

    const ok = await call(
      exportFileRoute,
      asClientA(),
      url.pathname + url.search,
      'GET',
      undefined,
      params,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/csv');
    expect(ok.headers.get('content-disposition')).toBe('attachment; filename="sessions.csv"');
    expect((await ok.text()).split('\r\n')[0]).toContain('session_id');

    // Another user of the same organization holding the URL.
    expect(
      (await call(exportFileRoute, asCoachA(), url.pathname + url.search, 'GET', undefined, params))
        .status,
    ).toBe(403);
    // A coach can't mint links for the client's export.
    expect(
      (
        await call(
          exportLinksRoute,
          asCoachA(),
          `/api/v1/exports/${job.id}/links`,
          'POST',
          undefined,
          { id: job.id },
        )
      ).status,
    ).toBe(403);

    // An expired link.
    const old = signExportLink(
      { jobId: job.id, file: 'sessions.csv', userId: t.clientA.id },
      Date.now() - 16 * 60_000,
    );
    const expired = await call(
      exportFileRoute,
      asClientA(),
      `/api/v1/exports/${job.id}/files/sessions.csv?token=${encodeURIComponent(old.token)}`,
      'GET',
      undefined,
      params,
    );
    expect(expired.status).toBe(403);
    expect((await expired.json()).error.message).toMatch(/expired/);
    // A tampered token.
    const bad = await call(
      exportFileRoute,
      asClientA(),
      `/api/v1/exports/${job.id}/files/sessions.csv?token=x.y`,
      'GET',
      undefined,
      params,
    );
    expect(bad.status).toBe(403);
  });

  it('only an owner exports the organization; a client cannot', async () => {
    expect(
      (
        await call(exportsPostRoute, asClientA(), '/api/v1/exports', 'POST', {
          scope: 'org',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(exportsPostRoute, asCoachA(), '/api/v1/exports', 'POST', {
          scope: 'org',
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(202);
  });
});
