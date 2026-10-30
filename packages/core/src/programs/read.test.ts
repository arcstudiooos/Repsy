import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import type { ActorContext } from '../authz/actor';
import { getProgram } from './read';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

describe('getProgram history reads', () => {
  it('renders a stored version whose targetJson is outside current bounds (lenient parse)', async () => {
    const seeded = await withSystem(async (tx) => {
      const user = await tx.user.create({ data: { email: 'o@example.test', name: 'O' } });
      const org = await tx.organization.create({
        data: { name: 'O', timezone: 'UTC', ownerUserId: user.id },
      });
      const program = await tx.program.create({
        data: { organizationId: org.id, title: 'Old', createdBy: user.id },
      });
      const wv = await tx.workoutVersion.create({
        data: { organizationId: org.id, title: 'Legacy', contentHash: 'x' },
      });
      // reps 5000, rpe 11 and loadKg 99999 would all fail today's strict targetSchema.
      await tx.workoutVersionExercise.create({
        data: {
          organizationId: org.id,
          workoutVersionId: wv.id,
          exerciseId: 'e0000000-0000-4000-8000-000000000001',
          position: 0,
          targetJson: [{ reps: 5000, rpe: 11, loadKg: 99999 }],
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
      await tx.program.update({ where: { id: program.id }, data: { currentVersionId: pv.id } });
      return { userId: user.id, orgId: org.id, programId: program.id, versionId: pv.id };
    }, prisma);
    const actor: ActorContext = {
      userId: seeded.userId,
      orgId: seeded.orgId,
      role: 'owner',
      isPlatformAdmin: false,
    };
    const detail = await withTenant(
      seeded.orgId,
      (tx) => getProgram(tx, actor, seeded.programId, { versionId: seeded.versionId }),
      prisma,
    );
    expect(detail.weeks[0]!.days[0]!.exercises[0]!.sets).toEqual([
      { reps: 5000, rpe: 11, loadKg: 99999 },
    ]);
  });
});
