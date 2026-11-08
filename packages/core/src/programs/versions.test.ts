import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@repsy/db';
import { createTestDb } from '@repsy/db/testing';
import type { ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { commitProgramVersion, type WeekInput } from './commit';
import { createProgram, getProgram } from './read';
import { listProgramVersions } from './versions';

let prisma: PrismaClient;
let drop: () => Promise<void>;
let actor: ActorContext;
let programId: string;

const BENCH = 'e0000000-0000-4000-8000-000000000001';
const run = <T>(fn: Parameters<typeof withTenant<T>>[1]) =>
  withTenant(actor.orgId, fn, prisma, { userId: actor.userId });
const weeks = (title: string): WeekInput[] => [
  { days: [{ title, exercises: [{ exerciseId: BENCH, sets: [{ reps: 8, loadKg: 60 }] }] }] },
];

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
  const user = await withSystem(
    (tx) => tx.user.create({ data: { email: 'c@example.test', name: 'Coach C' } }),
    prisma,
  );
  const org = await withSystem(
    (tx) => tx.organization.create({ data: { name: 'O', timezone: 'UTC', ownerUserId: user.id } }),
    prisma,
  );
  actor = { userId: user.id, orgId: org.id, role: 'owner', isPlatformAdmin: false };
  programId = (await run((tx) => createProgram(tx, actor, { title: 'P' }))).id;
  for (const [i, t] of ['One', 'Two', 'Three'].entries()) {
    await run((tx) =>
      commitProgramVersion(tx, actor, {
        programId,
        expectedVersionNo: i === 0 ? null : i,
        weeks: weeks(t),
      }),
    );
  }
});
afterAll(async () => {
  await drop();
});

describe('program versions', () => {
  it('three commits list newest first with committer name', async () => {
    const list = await run((tx) => listProgramVersions(tx, actor, programId));
    expect(list.map((v) => v.versionNo)).toEqual([3, 2, 1]);
    expect(list[0]).toMatchObject({ committedBy: { id: actor.userId, name: 'Coach C' } });
    expect(Number.isNaN(Date.parse(list[0]!.committedAt))).toBe(false);
  });

  it('getProgram versionNo 1 after commits returns v1 content', async () => {
    const v1 = await run((tx) => getProgram(tx, actor, programId, { versionNo: 1 }));
    expect(v1.versionNo).toBe(1);
    expect(v1.weeks[0]?.days[0]?.title).toBe('One');
    const cur = await run((tx) => getProgram(tx, actor, programId));
    expect(cur.versionNo).toBe(3);
  });

  it('versionNo 9 -> NOT_FOUND', async () => {
    const err = await run((tx) => getProgram(tx, actor, programId, { versionNo: 9 })).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('NOT_FOUND');
  });
});
