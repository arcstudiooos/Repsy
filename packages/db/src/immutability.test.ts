import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './testing/createTestDb';
import { withSystem, withTenant } from './tenant';
import type { PrismaClient } from './generated/client';

const BENCH = 'e0000000-0000-4000-8000-000000000001';

let prisma: PrismaClient;
let schema: string;
let drop: () => Promise<void>;
let orgId: string;

const TABLES = [
  'workout_versions',
  'workout_version_exercises',
  'program_versions',
  'program_slots',
] as const;

beforeAll(async () => {
  ({ prisma, schema, drop } = await createTestDb());
  await withSystem(async (tx) => {
    const user = await tx.user.create({ data: { email: 'u@example.test', name: 'U' } });
    const org = await tx.organization.create({
      data: { name: 'O', timezone: 'UTC', ownerUserId: user.id },
    });
    orgId = org.id;
    const program = await tx.program.create({
      data: { organizationId: org.id, title: 'P', createdBy: user.id },
    });
    const wv = await tx.workoutVersion.create({
      data: { organizationId: org.id, title: 'W', contentHash: 'h' },
    });
    await tx.workoutVersionExercise.create({
      data: {
        organizationId: org.id,
        workoutVersionId: wv.id,
        exerciseId: BENCH,
        position: 0,
        targetJson: [{ reps: 5 }],
      },
    });
    const pv = await tx.programVersion.create({
      data: {
        organizationId: org.id,
        programId: program.id,
        versionNo: 1,
        committedBy: user.id,
        daysPerWeek: 1,
        weekCount: 1,
      },
    });
    await tx.programSlot.create({
      data: {
        organizationId: org.id,
        programVersionId: pv.id,
        weekIndex: 0,
        dayIndex: 0,
        workoutVersionId: wv.id,
      },
    });
  }, prisma);
});
afterAll(async () => {
  await drop();
});

type Delegate = {
  updateMany(args: unknown): Promise<unknown>;
  deleteMany(args: unknown): Promise<unknown>;
};
const touch = {
  workout_versions: { title: 'X' },
  workout_version_exercises: { position: 9 },
  program_versions: { weekCount: 9 },
  program_slots: { weekIndex: 9 },
} as const;
const model = {
  workout_versions: 'workoutVersion',
  workout_version_exercises: 'workoutVersionExercise',
  program_versions: 'programVersion',
  program_slots: 'programSlot',
} as const;

describe('D-001 history is immutable at the database level', () => {
  for (const table of TABLES) {
    const pick = (tx: unknown) => (tx as Record<string, Delegate>)[model[table]]!;

    it(`${table}: tenant tx cannot update or delete`, async () => {
      await expect(
        withTenant(orgId, (tx) => pick(tx).updateMany({ where: {}, data: touch[table] }), prisma),
      ).rejects.toThrow(/immutable/i);
      await expect(
        withTenant(orgId, (tx) => pick(tx).deleteMany({ where: {} }), prisma),
      ).rejects.toThrow(/immutable/i);
    });

    it(`${table}: system tx (RLS bypass) cannot update or delete`, async () => {
      await expect(
        withSystem((tx) => pick(tx).updateMany({ where: {}, data: touch[table] }), prisma),
      ).rejects.toThrow(/immutable/i);
      await expect(withSystem((tx) => pick(tx).deleteMany({ where: {} }), prisma)).rejects.toThrow(
        /immutable/i,
      );
    });

    it(`${table}: TRUNCATE is blocked`, async () => {
      await expect(
        prisma.$executeRawUnsafe(`TRUNCATE "${schema}"."${table}" CASCADE`),
      ).rejects.toThrow(/immutable/i);
    });
  }

  it('inserts still work', async () => {
    await expect(
      withSystem(
        (tx) =>
          tx.workoutVersion.create({
            data: { organizationId: orgId, title: 'Another', contentHash: 'h2' },
          }),
        prisma,
      ),
    ).resolves.toMatchObject({ title: 'Another' });
  });
});
