import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { createExercise, searchExercises, type ExerciseView } from './exercises';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let coachId: string;

const actorFor = (orgId: string, role: ActorContext['role'] = 'owner'): ActorContext => ({
  userId: coachId,
  orgId,
  role,
  isPlatformAdmin: false,
});

async function newOrg(): Promise<ActorContext> {
  const org = await withSystem(
    (tx) => tx.organization.create({ data: { name: 'O', timezone: 'UTC', ownerUserId: coachId } }),
    prisma,
  );
  return actorFor(org.id);
}

const run = <T>(actor: ActorContext, fn: Parameters<typeof withTenant<T>>[1]) =>
  withTenant(actor.orgId, fn, prisma, { userId: actor.userId });

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e: unknown) => (e instanceof DomainError ? e.code : 'other'),
  );

const base = {
  name: 'Zercher Squat',
  equipment: 'Barbell',
  muscleGroup: 'Quads',
  movementType: 'Squat',
  trackingType: 'reps_load' as const,
};

/** Every page of a search, following cursors. */
async function searchAll(
  actor: ActorContext,
  query: Omit<Parameters<typeof searchExercises>[2], 'cursor'> = {},
) {
  const items: ExerciseView[] = [];
  let cursor: string | undefined;
  do {
    const page = await run(actor, (tx) => searchExercises(tx, actor, { ...query, cursor }));
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

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

describe('global catalog', () => {
  it('catalog has ≥75 globals covering all three tracking types', async () => {
    const globals = await withSystem(
      (tx) => tx.exercise.findMany({ where: { organizationId: null } }),
      prisma,
    );
    expect(globals.length).toBeGreaterThanOrEqual(75);
    expect(new Set(globals.map((g) => g.trackingType))).toEqual(
      new Set(['reps_load', 'duration', 'distance']),
    );
    for (const g of globals) {
      expect(g.mediaUrl, g.name).toBeNull();
      expect(g.instructions.length, g.name).toBeGreaterThan(0);
    }
  });

  it('globals visible to both orgs', async () => {
    const a = await newOrg();
    const b = await newOrg();
    const seenA = await searchAll(a, { q: 'Barbell Bench Press' });
    const seenB = await searchAll(b, { q: 'Barbell Bench Press' });
    expect(seenA.map((e) => e.name)).toEqual(['Barbell Bench Press']);
    expect(seenB.map((e) => e.name)).toEqual(['Barbell Bench Press']);
    expect(seenA[0]?.isGlobal).toBe(true);
    expect(seenA[0]?.id).toBe(seenB[0]?.id);
  });

  it('tenant cannot update or delete a global (0 rows affected)', async () => {
    const a = await newOrg();
    const before = await withSystem(
      (tx) => tx.exercise.findFirstOrThrow({ where: { organizationId: null, name: 'Plank' } }),
      prisma,
    );
    const { upd, del } = await run(a, async (tx) => ({
      upd: await tx.exercise.updateMany({ where: { id: before.id }, data: { name: 'Hacked' } }),
      del: await tx.exercise.deleteMany({ where: { id: before.id } }),
    }));
    expect(upd.count).toBe(0);
    expect(del.count).toBe(0);
    const after = await withSystem(
      (tx) => tx.exercise.findUniqueOrThrow({ where: { id: before.id } }),
      prisma,
    );
    expect(after.name).toBe('Plank');
  });
});

describe('createExercise', () => {
  it('org A custom invisible to org B; audits exercise.created', async () => {
    const a = await newOrg();
    const b = await newOrg();
    const made = await run(a, (tx) => createExercise(tx, a, base, { requestId: 'req-1' }));
    expect(made).toMatchObject({ name: 'Zercher Squat', isGlobal: false, mediaUrl: null });
    expect((await searchAll(a, { q: 'Zercher' })).map((e) => e.id)).toEqual([made.id]);
    expect(await searchAll(b, { q: 'Zercher' })).toEqual([]);
    const audit = await withSystem(
      (tx) => tx.auditEvent.findFirst({ where: { objectId: made.id, action: 'exercise.created' } }),
      prisma,
    );
    expect(audit).toMatchObject({ organizationId: a.orgId, objectType: 'exercise' });
  });

  it('rejects non-https media urls', async () => {
    const a = await newOrg();
    for (const mediaUrl of ['javascript:alert(1)', 'http://example.test/a.png', 'not a url']) {
      expect(
        await code(run(a, (tx) => createExercise(tx, a, { ...base, mediaUrl }))),
        mediaUrl,
      ).toBe('VALIDATION');
    }
    const ok = await run(a, (tx) =>
      createExercise(tx, a, { ...base, mediaUrl: 'https://example.test/a.png' }),
    );
    expect(ok.mediaUrl).toBe('https://example.test/a.png');
  });

  it('duplicate custom name (case-insensitive) → CONFLICT; other org and globals are fine', async () => {
    const a = await newOrg();
    const b = await newOrg();
    await run(a, (tx) => createExercise(tx, a, base));
    expect(
      await code(run(a, (tx) => createExercise(tx, a, { ...base, name: 'zercher SQUAT' }))),
    ).toBe('CONFLICT');
    await run(b, (tx) => createExercise(tx, b, base));
    await run(a, (tx) => createExercise(tx, a, { ...base, name: 'plank' }));
  });

  it('validates lengths and tracking type; trims', async () => {
    const a = await newOrg();
    const bad = (patch: object) =>
      code(run(a, (tx) => createExercise(tx, a, { ...base, ...patch } as typeof base)));
    expect(await bad({ name: '   ' })).toBe('VALIDATION');
    expect(await bad({ name: 'x'.repeat(81) })).toBe('VALIDATION');
    expect(await bad({ equipment: 'x'.repeat(41) })).toBe('VALIDATION');
    expect(await bad({ muscleGroup: '' })).toBe('VALIDATION');
    expect(await bad({ movementType: 'x'.repeat(41) })).toBe('VALIDATION');
    expect(await bad({ instructions: 'x'.repeat(2001) })).toBe('VALIDATION');
    expect(await bad({ trackingType: 'weight' })).toBe('VALIDATION');
    expect(await bad({ mediaUrl: `https://e.test/${'x'.repeat(500)}` })).toBe('VALIDATION');
    const ok = await run(a, (tx) => createExercise(tx, a, { ...base, name: '  Sandbag Carry  ' }));
    expect(ok.name).toBe('Sandbag Carry');
  });

  it('client role cannot create or read', async () => {
    const a = await newOrg();
    const client = { ...a, role: 'client' as const };
    expect(await code(run(client, (tx) => createExercise(tx, client, base)))).toBe('FORBIDDEN');
    expect(await code(run(client, (tx) => searchExercises(tx, client, {})))).toBe('FORBIDDEN');
  });
});

describe('searchExercises', () => {
  it('filters, sorts by name then id, and pages at 50', async () => {
    const a = await newOrg();
    const all = await searchAll(a);
    expect(all.length).toBeGreaterThan(50);
    // Keyset paging over the database's collation: every row exactly once, none skipped.
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    const total = await withSystem(
      (tx) => tx.exercise.count({ where: { organizationId: null } }),
      prisma,
    );
    expect(all.length).toBe(total);
    const first = await run(a, (tx) => searchExercises(tx, a, {}));
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();

    const distance = await searchAll(a, { trackingType: 'distance' });
    expect(distance.length).toBeGreaterThan(5);
    expect(distance.every((e) => e.trackingType === 'distance')).toBe(true);
    const chestBarbell = await searchAll(a, { muscleGroup: 'chest', equipment: 'BARBELL' });
    expect(chestBarbell.map((e) => e.name)).toContain('Barbell Bench Press');
    expect(chestBarbell.every((e) => e.muscleGroup === 'Chest')).toBe(true);
  });

  it('search text matches literally (LIKE metacharacters escaped) and validates', async () => {
    const a = await newOrg();
    expect(await searchAll(a, { q: '%' })).toEqual([]);
    expect(await searchAll(a, { q: '_' })).toEqual([]);
    expect((await searchAll(a, { q: 'pull-up' })).map((e) => e.name)).toEqual(['Pull-Up']);
    expect(await code(run(a, (tx) => searchExercises(tx, a, { q: ' ' })))).toBe('VALIDATION');
    expect(await code(run(a, (tx) => searchExercises(tx, a, { cursor: 'junk' })))).toBe(
      'VALIDATION',
    );
    expect(
      await code(run(a, (tx) => searchExercises(tx, a, { trackingType: 'x' as 'duration' }))),
    ).toBe('VALIDATION');
  });
});
