import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DomainError, logger } from '@kinetic/core';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { createAuth, type Auth } from '@/lib/auth';
import { ApiResult, createApiHandler } from '@/server/api';
import { InMemoryRateLimiter } from '@/server/rateLimit';
import { seedTwoTenants, headersFor, TEST_SECRET, type TwoTenants } from './harness/tenants';

const ORIGIN = 'http://localhost:3000';
const env = {
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET: TEST_SECRET,
  DISABLE_BREACHED_PASSWORD_CHECK: 'true',
};

let prisma: PrismaClient;
/** Better Auth's client: sees every users row (test assertions on users go through it). */
let authPrisma: PrismaClient;
let drop: () => Promise<void>;
let auth: Auth;
let t: TwoTenants;

const make = (limiter = new InMemoryRateLimiter({ capacity: 1000, refillPerSecond: 1000 })) =>
  createApiHandler({ auth, prisma, secret: TEST_SECRET, appBaseUrl: ORIGIN, limiter });

const req = (
  method: string,
  headers: Headers,
  body?: unknown,
  extra: Record<string, string> = {},
) => {
  const h = new Headers(headers);
  if (method !== 'GET') h.set('origin', ORIGIN);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  if (body !== undefined) h.set('content-type', 'application/json');
  return new Request(`${ORIGIN}/api/v1/test`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

describe('api envelope', () => {
  it('wraps success in { data }', async () => {
    const handler = make()({ handler: () => ({ ok: true }) });
    const res = await handler(req('GET', headersFor(t.coachA)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('a 204 result keeps its own headers next to x-request-id', async () => {
    const handler = make()({
      handler: () => new ApiResult(null, { status: 204, headers: { 'x-extra': 'kept' } }),
    });
    const res = await handler(req('GET', headersFor(t.coachA)));
    expect(res.status).toBe(204);
    expect(res.headers.get('x-extra')).toBe('kept');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('422 includes fieldErrors and requestId', async () => {
    const handler = make()({
      input: z.object({ name: z.string().min(2) }),
      handler: () => ({}),
    });
    const res = await handler(req('POST', headersFor(t.coachA), { name: 'x' }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; fieldErrors: Record<string, string[]>; requestId: string };
    };
    expect(body.error.code).toBe('VALIDATION');
    expect(body.error.fieldErrors.name?.length).toBeGreaterThan(0);
    expect(body.error.requestId).toBe(res.headers.get('x-request-id'));
  });

  it('unknown error → 500 with code INTERNAL and requestId, no stack', async () => {
    const handler = make()({
      handler: () => {
        throw new Error('db exploded at /secret/path');
      },
    });
    const res = await handler(req('GET', headersFor(t.coachA)));
    expect(res.status).toBe(500);
    const text = await res.text();
    const body = JSON.parse(text) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.requestId).toBeTruthy();
    expect(text).not.toContain('exploded');
    expect(text).not.toContain('/secret/path');
    expect(text).not.toMatch(/\bat \S+ \(/);
  });

  it('an unmapped unique-key violation (Prisma P2002) → 409 CONFLICT, not 500', async () => {
    const handler = make()({
      handler: () => {
        throw Object.assign(new Error('Unique constraint failed on (email)'), { code: 'P2002' });
      },
    });
    const res = await handler(req('POST', headersFor(t.coachA), {}));
    expect(res.status).toBe(409);
    const text = await res.text();
    expect((JSON.parse(text) as { error: { code: string } }).error.code).toBe('CONFLICT');
    expect(text).not.toContain('email');
  });

  it('catch-all never logs error message', async () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      const handler = make()({
        handler: () => {
          throw new Error('client email jane@example.test');
        },
      });
      const res = await handler(req('GET', headersFor(t.coachA)));
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: { code: string; requestId: string } };
      expect(body.error.code).toBe('INTERNAL');
      expect(body.error.requestId).toBeTruthy();
      expect(spy).toHaveBeenCalled();
      expect(JSON.stringify(spy.mock.calls)).not.toContain('jane@example.test');
      const [fields] = spy.mock.calls[0] as unknown as [{ errName: string; stack: string }];
      expect(fields.errName).toBe('Error');
      expect(fields.stack.split('\n')[0]).toBe('Error');
    } finally {
      spy.mockRestore();
    }
  });

  it('serializes DomainError details as error.details, and omits it otherwise', async () => {
    const withDetails = make()({
      handler: () => {
        throw new DomainError('CONFLICT', 'stale', undefined, { currentVersionNo: 3 });
      },
    });
    const res = await withDetails(req('GET', headersFor(t.coachA)));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: Record<string, unknown> };
    expect(body.error).toMatchObject({ code: 'CONFLICT', details: { currentVersionNo: 3 } });

    const plain = make()({
      handler: () => {
        throw new DomainError('NOT_FOUND', 'nope');
      },
    });
    const plainBody = (await (await plain(req('GET', headersFor(t.coachA)))).json()) as {
      error: Record<string, unknown>;
    };
    expect(plainBody.error).not.toHaveProperty('details');
  });

  it('maps DomainError codes to statuses', async () => {
    const cases = [
      ['NOT_FOUND', 404],
      ['FORBIDDEN', 403],
      ['VALIDATION', 422],
      ['CONFLICT', 409],
      ['RATE_LIMITED', 429],
    ] as const;
    for (const [code, status] of cases) {
      const handler = make()({
        handler: () => {
          throw new DomainError(code, 'nope');
        },
      });
      expect((await handler(req('GET', headersFor(t.coachA)))).status).toBe(status);
    }
  });

  it('401 without a session', async () => {
    const res = await make()({ handler: () => ({}) })(req('GET', new Headers()));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
  });

  it('rejects non-GET with a foreign or missing Origin (CSRF)', async () => {
    const handler = make()({ handler: () => ({}) });
    const foreign = await handler(
      req('POST', headersFor(t.coachA), {}, { origin: 'https://evil.example' }),
    );
    expect(foreign.status).toBe(403);
    const missing = await handler(
      new Request(`${ORIGIN}/api/v1/test`, {
        method: 'POST',
        headers: headersFor(t.coachA),
        body: '{}',
      }),
    );
    expect(missing.status).toBe(403);
  });

  it('400 on malformed JSON', async () => {
    const handler = make()({ input: z.object({}), handler: () => ({}) });
    const h = headersFor(t.coachA);
    h.set('origin', ORIGIN);
    h.set('content-type', 'application/json');
    const res = await handler(
      new Request(`${ORIGIN}/api/v1/test`, { method: 'POST', headers: h, body: '{nope' }),
    );
    expect(res.status).toBe(400);
  });

  it('429 with Retry-After once the per-user bucket is empty', async () => {
    const handler = make(new InMemoryRateLimiter({ capacity: 2, refillPerSecond: 0.001 }))({
      handler: () => ({}),
    });
    const send = (u = t.coachA) => handler(req('GET', headersFor(u)));
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect((await send(t.coachB)).status).toBe(200);
  });

  it('409 ORG_SELECTION_REQUIRED for multi-org users without a cookie', async () => {
    const res = await make()({ handler: () => ({}) })(req('GET', headersFor(t.dualRoleUser)));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'ORG_SELECTION_REQUIRED' } });
  });

  it('tampered org cookie is treated as absent', async () => {
    const good = headersFor(t.dualRoleUser, t.orgB.id).get('cookie') ?? '';
    const tampered = good.replace(t.orgB.id, t.orgA.id);
    expect(tampered).not.toBe(good);
    const res = await make()({ handler: () => ({}) })(
      req('GET', new Headers({ cookie: tampered })),
    );
    expect(res.status).toBe(409);
  });

  it('valid org cookie selects the active org for a multi-org user', async () => {
    const res = await make()({ handler: ({ actor }) => ({ org: actor.orgId, role: actor.role }) })(
      req('GET', headersFor(t.dualRoleUser, t.orgB.id)),
    );
    expect(await res.json()).toEqual({ data: { org: t.orgB.id, role: 'client' } });
  });

  it('malformed (bad percent-encoding) org cookie behaves as absent, not 500', async () => {
    const h = headersFor(t.dualRoleUser);
    h.set('cookie', `${h.get('cookie')}; kinetic_org=%E0%A4`);
    const res = await make()({ handler: () => ({}) })(req('GET', h));
    expect(res.status).toBe(409);
    const single = headersFor(t.coachA);
    single.set('cookie', `${single.get('cookie')}; kinetic_org=%E0%A4`);
    expect((await make()({ handler: () => ({}) })(req('GET', single))).status).toBe(200);
  });

  it('actor carries isPlatformAdmin from the session user', async () => {
    const handler = make()({ handler: ({ actor }) => ({ admin: actor.isPlatformAdmin }) });
    expect(await (await handler(req('GET', headersFor(t.coachA)))).json()).toEqual({
      data: { admin: false },
    });
    await withSystem(
      (tx) => tx.user.update({ where: { id: t.coachB.id }, data: { isPlatformAdmin: true } }),
      prisma,
    );
    try {
      expect(await (await handler(req('GET', headersFor(t.coachB)))).json()).toEqual({
        data: { admin: true },
      });
    } finally {
      await withSystem(
        (tx) => tx.user.update({ where: { id: t.coachB.id }, data: { isPlatformAdmin: false } }),
        prisma,
      );
    }
  });

  it('tenant() runs as the acting user: their own users row is writable', async () => {
    const handler = make()({
      handler: ({ actor, tenant }) =>
        tenant((tx) =>
          tx.user.update({
            where: { id: actor.userId },
            data: { name: 'coach-a' },
            select: { id: true },
          }),
        ),
    });
    const res = await handler(req('GET', headersFor(t.coachA)));
    expect(await res.json()).toEqual({ data: { id: t.coachA.id } });
  });

  it('per-route rateLimit uses its own bucket instead of the global one', async () => {
    const define = make();
    const strict = define({
      rateLimit: { capacity: 1, refillPerSecond: 0.001 },
      handler: () => ({}),
    });
    const normal = define({ handler: () => ({}) });
    const h = () => req('GET', headersFor(t.clientA));
    expect((await strict(h())).status).toBe(200);
    const limited = await strict(h());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect((await normal(h())).status).toBe(200);
  });

  it('can + requireOrg: false is rejected when the route is defined', () => {
    expect(() => make()({ requireOrg: false, can: 'org:read', handler: () => ({}) })).toThrow(
      /requireOrg/,
    );
  });
});
