import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { decodeCursor, encodeCursor } from '../pagination';
import { canonicalTimezone } from '../timezone';
import { createClient, listClients, updateClient } from './clients';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let coachId: string;
const orgs: string[] = [];

const actorFor = (orgId: string): ActorContext => ({
  userId: coachId,
  orgId,
  role: 'owner',
  isPlatformAdmin: false,
});

/** A fresh organization per test group keeps limits and listings independent. */
async function newOrg(timezone = 'Europe/London'): Promise<ActorContext> {
  const org = await withSystem(
    (tx) => tx.organization.create({ data: { name: 'O', timezone, ownerUserId: coachId } }),
    prisma,
  );
  orgs.push(org.id);
  return actorFor(org.id);
}

const run = <T>(actor: ActorContext, fn: Parameters<typeof withTenant<T>>[1]) =>
  withTenant(actor.orgId, fn, prisma, { userId: actor.userId });

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : 'other'),
  );

/** Seeds raw rows quickly (system scope), bypassing the limit. */
const seedClients = (
  actor: ActorContext,
  rows: { name: string; email: string; status?: 'invited' | 'active' | 'archived' }[],
) =>
  withSystem(
    (tx) =>
      tx.client.createMany({
        data: rows.map((r) => ({
          organizationId: actor.orgId,
          coachUserId: coachId,
          name: r.name,
          email: r.email,
          status: r.status ?? 'invited',
          timezone: 'UTC',
        })),
      }),
    prisma,
  );

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  coachId = (
    await withSystem(
      (tx) => tx.user.create({ data: { email: 'c@example.test', name: 'C' } }),
      prisma,
    )
  ).id;
});
afterAll(async () => {
  await drop();
});

describe('createClient', () => {
  it('creates invited client with org timezone default', async () => {
    const actor = await newOrg('Asia/Tokyo');
    const view = await run(actor, (tx) =>
      createClient(tx, actor, { name: '  Ann  ', email: 'Ann@Example.TEST', goals: 'Stronger' }),
    );
    expect(view).toMatchObject({
      name: 'Ann',
      email: 'ann@example.test',
      status: 'invited',
      timezone: 'Asia/Tokyo',
      preferredUnits: 'kg',
      goals: 'Stronger',
      startDate: null,
    });
    const row = await withSystem(
      (tx) => tx.client.findUniqueOrThrow({ where: { id: view.id } }),
      prisma,
    );
    expect(row).toMatchObject({ organizationId: actor.orgId, coachUserId: coachId, userId: null });
  });

  it('the default zone from a legacy org row is stored canonical', async () => {
    const actor = await newOrg('Asia/Kolkata');
    const view = await run(actor, (tx) =>
      createClient(tx, actor, { name: 'Z', email: 'zone@example.test' }),
    );
    expect(view.timezone).toBe(canonicalTimezone('Asia/Kolkata'));
  });

  it('31st invited-or-active client → CLIENT_LIMIT_REACHED (archived do not count)', async () => {
    const actor = await newOrg();
    await seedClients(actor, [
      ...Array.from({ length: 28 }, (_, i) => ({ name: `n${i}`, email: `n${i}@example.test` })),
      { name: 'act', email: 'act@example.test', status: 'active' },
      { name: 'arch', email: 'arch@example.test', status: 'archived' },
    ]);
    // 29 counted + 1 archived: the 30th succeeds, the 31st fails.
    await run(actor, (tx) =>
      createClient(tx, actor, { name: 'Thirty', email: 't30@example.test' }),
    );
    expect(
      await code(
        run(actor, (tx) => createClient(tx, actor, { name: 'X', email: 'x31@example.test' })),
      ),
    ).toBe('CLIENT_LIMIT_REACHED');
    const err = await run(actor, (tx) =>
      createClient(tx, actor, { name: 'Y', email: 'y31@example.test' }),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).details).toEqual({ limit: 30 });
  });

  it('limit holds under concurrency', async () => {
    const actor = await newOrg();
    await seedClients(
      actor,
      Array.from({ length: 29 }, (_, i) => ({ name: `n${i}`, email: `n${i}@example.test` })),
    );
    // Barrier so every transaction is open before any creates: maximizes the race.
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const results = await Promise.all(
      names.map((n) =>
        code(
          run(actor, async (tx) => {
            if (++arrived === names.length) release();
            await gate;
            return createClient(tx, actor, { name: n, email: `${n}@example.test` });
          }),
        ),
      ),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'CLIENT_LIMIT_REACHED')).toHaveLength(names.length - 1);
    const count = await withSystem(
      (tx) => tx.client.count({ where: { organizationId: actor.orgId } }),
      prisma,
    );
    expect(count).toBe(30);
  });

  it('duplicate email (case-insensitive) → EMAIL_TAKEN', async () => {
    const actor = await newOrg();
    await run(actor, (tx) => createClient(tx, actor, { name: 'A', email: 'dup@example.test' }));
    expect(
      await code(
        run(actor, (tx) => createClient(tx, actor, { name: 'B', email: 'DUP@Example.test' })),
      ),
    ).toBe('EMAIL_TAKEN');
  });

  it('rejects invalid input and non-coach roles', async () => {
    const actor = await newOrg();
    expect(
      await code(
        run(actor, (tx) => createClient(tx, actor, { name: '', email: 'a@example.test' })),
      ),
    ).toBe('VALIDATION');
    expect(
      await code(run(actor, (tx) => createClient(tx, actor, { name: 'A', email: 'nope' }))),
    ).toBe('VALIDATION');
    const clientActor = { ...actor, role: 'client' as const };
    expect(
      await code(
        run(actor, (tx) => createClient(tx, clientActor, { name: 'A', email: 'z@example.test' })),
      ),
    ).toBe('FORBIDDEN');
  });
});

describe('listClients', () => {
  it('search escapes wildcards', async () => {
    const actor = await newOrg();
    await seedClients(actor, [
      { name: '50%_off', email: 'p1@example.test' },
      { name: '5000 off', email: 'p2@example.test' },
      { name: 'a\\b', email: 'p3@example.test' },
    ]);
    const names = async (q: string) =>
      (await run(actor, (tx) => listClients(tx, actor, { q }))).items.map((c) => c.name);
    expect(await names('%_')).toEqual(['50%_off']);
    expect(await names('A\\B')).toEqual(['a\\b']);
    expect(await names('P2@')).toEqual(['5000 off']);
    expect(await code(run(actor, (tx) => listClients(tx, actor, { q: 'x'.repeat(101) })))).toBe(
      'VALIDATION',
    );
    expect(await code(run(actor, (tx) => listClients(tx, actor, { q: '   ' })))).toBe('VALIDATION');
  });

  it('filters by status', async () => {
    const actor = await newOrg();
    await seedClients(actor, [
      { name: 'i', email: 'i@example.test' },
      { name: 'a', email: 'a@example.test', status: 'active' },
    ]);
    const res = await run(actor, (tx) => listClients(tx, actor, { status: 'active' }));
    expect(res.items.map((c) => c.name)).toEqual(['a']);
  });

  it('pagination is stable', async () => {
    const actor = await newOrg();
    // Identical createdAt for all rows exercises the id tiebreak.
    const at = new Date();
    await withSystem(
      (tx) =>
        tx.client.createMany({
          data: Array.from({ length: 30 }, (_, i) => ({
            organizationId: actor.orgId,
            coachUserId: coachId,
            name: `c${i}`,
            email: `c${i}@example.test`,
            timezone: 'UTC',
            createdAt: at,
          })),
        }),
      prisma,
    );
    const p1 = await run(actor, (tx) => listClients(tx, actor, {}));
    expect(p1.items).toHaveLength(25);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await run(actor, (tx) =>
      listClients(tx, actor, { cursor: p1.nextCursor as string }),
    );
    expect(p2.items).toHaveLength(5);
    expect(p2.nextCursor).toBeNull();
    const ids = [...p1.items, ...p2.items].map((c) => c.id);
    expect(new Set(ids).size).toBe(30);
  });

  it('invalid cursor → VALIDATION', async () => {
    const actor = await newOrg();
    expect(await code(run(actor, (tx) => listClients(tx, actor, { cursor: 'garbage' })))).toBe(
      'VALIDATION',
    );
  });
});

describe('cursor codec', () => {
  it('round-trips', () => {
    const row = { createdAt: new Date('2026-01-02T03:04:05.678Z'), id: crypto.randomUUID() };
    expect(decodeCursor(encodeCursor(row))).toEqual(row);
  });
  it('rejects junk', () => {
    expect(() => decodeCursor('!!!')).toThrow(DomainError);
    expect(() => decodeCursor(Buffer.from('{"c":1}').toString('base64url'))).toThrow(DomainError);
  });
});

describe('updateClient', () => {
  it('archiving frees a slot; re-activating re-checks the limit', async () => {
    const actor = await newOrg();
    await seedClients(
      actor,
      Array.from({ length: 30 }, (_, i) => ({
        name: `n${i}`,
        email: `n${i}@example.test`,
        status: 'active' as const,
      })),
    );
    const list = await run(actor, (tx) => listClients(tx, actor, {}));
    const [first, second] = list.items;
    const archived = await run(actor, (tx) =>
      updateClient(tx, actor, first!.id, { status: 'archived' }),
    );
    expect(archived.status).toBe('archived');
    await run(actor, (tx) => createClient(tx, actor, { name: 'New', email: 'new@example.test' }));
    expect(
      await code(run(actor, (tx) => updateClient(tx, actor, first!.id, { status: 'active' }))),
    ).toBe('CLIENT_LIMIT_REACHED');
    const renamed = await run(actor, (tx) =>
      updateClient(tx, actor, second!.id, {
        name: ' Renamed ',
        startDate: '2026-02-01',
        goals: 'g',
      }),
    );
    expect(renamed).toMatchObject({
      status: 'active',
      name: 'Renamed',
      startDate: '2026-02-01',
      goals: 'g',
      pause: null,
    });
  });

  it('another org id → NOT_FOUND', async () => {
    const a = await newOrg();
    const b = await newOrg();
    const view = await run(a, (tx) => createClient(tx, a, { name: 'A', email: 'a@example.test' }));
    expect(await code(run(b, (tx) => updateClient(tx, b, view.id, { name: 'Hacked' })))).toBe(
      'NOT_FOUND',
    );
    expect(await code(run(b, (tx) => updateClient(tx, b, 'not-a-uuid', { name: 'x' })))).toBe(
      'NOT_FOUND',
    );
  });
});

describe('updateClient status transitions', () => {
  type S = 'invited' | 'active' | 'paused' | 'archived';
  let n = 0;
  /** One client in `status`; `linked` gives it a user (as if it accepted an invite). */
  async function seedOne(actor: ActorContext, status: S, linked = false): Promise<string> {
    n += 1;
    return withSystem(async (tx) => {
      const user = linked
        ? await tx.user.create({ data: { email: `u${n}@example.test`, name: 'U' } })
        : null;
      const row = await tx.client.create({
        data: {
          organizationId: actor.orgId,
          coachUserId: coachId,
          userId: user?.id ?? null,
          name: 'C',
          email: `t${n}@example.test`,
          status,
          timezone: 'UTC',
        },
      });
      return row.id;
    }, prisma);
  }

  const allowed: [S, boolean, S, S][] = [
    ['invited', false, 'archived', 'archived'],
    ['active', true, 'archived', 'archived'],
    ['paused', true, 'archived', 'archived'],
    ['archived', true, 'active', 'active'],
    // Never accepted: restoring puts the client back to invited, not active (D-007 consent).
    ['archived', false, 'active', 'invited'],
    ['archived', false, 'invited', 'invited'],
  ];
  it.each(allowed)('%s (linked=%s) -> %s gives %s', async (from, linked, to, expected) => {
    const actor = await newOrg();
    const id = await seedOne(actor, from, linked);
    const view = await run(actor, (tx) => updateClient(tx, actor, id, { status: to }));
    expect(view.status).toBe(expected);
  });

  const forbidden: [S, boolean, S][] = [
    ['invited', false, 'active'],
    ['invited', false, 'paused'],
    ['active', true, 'invited'],
    ['paused', true, 'invited'],
    ['archived', true, 'invited'],
    ['archived', true, 'paused'],
    ['archived', false, 'paused'],
  ];
  it.each(forbidden)(
    '%s (linked=%s) -> %s is CONFLICT and changes nothing',
    async (from, linked, to) => {
      const actor = await newOrg();
      const id = await seedOne(actor, from, linked);
      const err = await run(actor, (tx) => updateClient(tx, actor, id, { status: to })).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe('CONFLICT');
      expect((err as DomainError).message).toMatch(/can't|cannot/i);
      const row = await withSystem((tx) => tx.client.findUniqueOrThrow({ where: { id } }), prisma);
      expect(row.status).toBe(from);
    },
  );

  // Ruling 6: pausing and resuming move sessions, so they go through the pause API.
  it.each([
    ['active', 'paused'],
    ['paused', 'active'],
  ] as [S, S][])('%s -> %s is VALIDATION (use the pause API)', async (from, to) => {
    const actor = await newOrg();
    const id = await seedOne(actor, from, true);
    const err = await run(actor, (tx) => updateClient(tx, actor, id, { status: to })).catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { status: ['Use Pause program to pause or resume.'] },
    });
  });

  it('a paused client keeps their slot; archived -> invited re-checks the limit', async () => {
    const actor = await newOrg();
    await seedOne(actor, 'paused', true);
    const archived = await seedOne(actor, 'archived', false);
    await seedClients(
      actor,
      Array.from({ length: 29 }, (_, i) => ({ name: `f${i}`, email: `full${i}@example.test` })),
    );
    expect(
      await code(
        run(actor, (tx) => createClient(tx, actor, { name: 'X', email: 'x@example.test' })),
      ),
    ).toBe('CLIENT_LIMIT_REACHED');
    expect(
      await code(run(actor, (tx) => updateClient(tx, actor, archived, { status: 'invited' }))),
    ).toBe('CLIENT_LIMIT_REACHED');
  });
});
