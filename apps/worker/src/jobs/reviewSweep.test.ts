import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createTestDb } from '@kinetic/db/testing';
import { sweepReview } from './reviewSweep';

let prisma: PrismaClient;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, drop } = await createTestDb());
});
afterAll(async () => {
  await drop();
});

/** An org whose active client has two unstarted sessions due on 11-04 and 11-05 (UTC). */
async function seed(): Promise<{ clientId: string }> {
  return withSystem(async (tx) => {
    const coach = await tx.user.create({
      data: { email: `c-${crypto.randomUUID()}@example.test`, name: 'C' },
    });
    const org = await tx.organization.create({
      data: { name: 'O', timezone: 'UTC', ownerUserId: coach.id },
    });
    const client = await tx.client.create({
      data: {
        organizationId: org.id,
        coachUserId: coach.id,
        name: 'Cl',
        email: `cl-${crypto.randomUUID()}@example.test`,
        status: 'active',
        timezone: 'UTC',
      },
    });
    const wv = await tx.workoutVersion.create({
      data: { organizationId: org.id, title: 'W', contentHash: crypto.randomUUID() },
    });
    const program = await tx.program.create({
      data: {
        organizationId: org.id,
        title: 'P',
        kind: 'client',
        clientId: client.id,
        createdBy: coach.id,
      },
    });
    const pv = await tx.programVersion.create({
      data: {
        organizationId: org.id,
        programId: program.id,
        versionNo: 1,
        committedBy: coach.id,
        daysPerWeek: 2,
        weekCount: 1,
      },
    });
    await tx.programSlot.createMany({
      data: [0, 1].map((d) => ({
        organizationId: org.id,
        programVersionId: pv.id,
        weekIndex: 0,
        dayIndex: d,
        workoutVersionId: wv.id,
      })),
    });
    await tx.program.update({ where: { id: program.id }, data: { currentVersionId: pv.id } });
    const assignment = await tx.programAssignment.create({
      data: {
        organizationId: org.id,
        clientId: client.id,
        programId: program.id,
        startLocalDate: new Date('2026-11-04'),
        weekdays: [3, 4],
        timezone: 'UTC',
      },
    });
    for (const [d, date] of ['2026-11-04', '2026-11-05'].entries()) {
      await tx.workoutSession.create({
        data: {
          organizationId: org.id,
          assignmentId: assignment.id,
          clientId: client.id,
          slotWeekIndex: 0,
          slotDayIndex: d,
          scheduledLocalDate: new Date(date),
          scheduledAt: new Date(`${date}T00:00:00Z`),
          dueAt: new Date(`${date}T23:59:00Z`),
        },
      });
    }
    return { clientId: client.id };
  }, prisma);
}

describe('sweepReview', () => {
  it('raises once across runs and organizations', async () => {
    const a = await seed();
    const b = await seed();
    const now = new Date('2026-11-08T12:00:00Z');
    const first = await sweepReview(prisma, now);
    const second = await sweepReview(prisma, now);
    expect(first.opened).toBe(2);
    expect(second.opened).toBe(0);
    for (const { clientId } of [a, b]) {
      const flags = await withSystem(
        (tx) => tx.reviewFlag.findMany({ where: { clientId } }),
        prisma,
      );
      expect(flags.map((f) => f.ruleKey)).toEqual(['missed_workouts']);
    }
  });
});
