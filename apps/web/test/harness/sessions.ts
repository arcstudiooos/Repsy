import { createHash, randomUUID } from 'node:crypto';
import { withSystem, type PrismaClient } from '@repsy/db';

/** Barbell Bench Press (reps/load) and Plank (duration) from the global catalog. */
export const BENCH = 'e0000000-0000-4000-8000-000000000001';
export const PLANK = 'e0000000-0000-4000-8000-000000000065';

export interface SeededAssignment {
  clientId: string;
  assignmentId: string;
  /** In slot order. */
  sessionIds: string[];
  /** The workout version every slot points at, and its exercises (bench, then plank). */
  workoutVersionId: string;
  exerciseIds: { bench: string; plank: string };
}

/** Creates (or reuses) the active Client row linking `userId` to `orgId`. System scope; test setup only. */
export async function linkClient(
  prisma: PrismaClient,
  orgId: string,
  userId: string,
  coachUserId: string,
  opts: { preferredUnits?: 'kg' | 'lb'; timezone?: string } = {},
): Promise<string> {
  return withSystem(async (tx) => {
    const existing = await tx.client.findFirst({ where: { organizationId: orgId, userId } });
    if (existing) return existing.id;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const c = await tx.client.create({
      data: {
        organizationId: orgId,
        userId,
        coachUserId,
        name: user.name,
        email: user.email.toLowerCase(),
        status: 'active',
        timezone: opts.timezone ?? 'UTC',
        preferredUnits: opts.preferredUnits ?? 'kg',
      },
    });
    return c.id;
  }, prisma);
}

/** A client copy whose every slot shares one workout (bench 2 sets + plank 1 set), and `days` scheduled sessions. */
export async function seedAssignment(
  prisma: PrismaClient,
  orgId: string,
  clientId: string,
  coachUserId: string,
  opts: { days?: number; firstDate?: string } = {},
): Promise<SeededAssignment> {
  const days = opts.days ?? 2;
  const first = new Date(`${opts.firstDate ?? '2099-01-05'}T00:00:00Z`);
  return withSystem(async (tx) => {
    const wv = await tx.workoutVersion.create({
      data: {
        organizationId: orgId,
        title: 'Full body',
        contentHash: createHash('sha256').update(randomUUID()).digest('hex'),
      },
    });
    const bench = await tx.workoutVersionExercise.create({
      data: {
        organizationId: orgId,
        workoutVersionId: wv.id,
        exerciseId: BENCH,
        position: 0,
        targetJson: [
          { reps: 8, loadKg: 60 },
          { reps: 8, loadKg: 60 },
        ],
      },
    });
    const plank = await tx.workoutVersionExercise.create({
      data: {
        organizationId: orgId,
        workoutVersionId: wv.id,
        exerciseId: PLANK,
        position: 1,
        targetJson: [{ durationSec: 60 }],
      },
    });
    const program = await tx.program.create({
      data: {
        organizationId: orgId,
        title: 'Block',
        kind: 'client',
        clientId,
        createdBy: coachUserId,
      },
    });
    const pv = await tx.programVersion.create({
      data: {
        organizationId: orgId,
        programId: program.id,
        versionNo: 1,
        committedBy: coachUserId,
        daysPerWeek: days,
        weekCount: 1,
      },
    });
    await tx.programSlot.createMany({
      data: Array.from({ length: days }, (_, d) => ({
        organizationId: orgId,
        programVersionId: pv.id,
        weekIndex: 0,
        dayIndex: d,
        workoutVersionId: wv.id,
      })),
    });
    await tx.program.update({ where: { id: program.id }, data: { currentVersionId: pv.id } });
    // Ends any active assignment first (one active per client).
    await tx.programAssignment.updateMany({
      where: { clientId, status: 'active' },
      data: { status: 'ended', endedAt: new Date() },
    });
    const assignment = await tx.programAssignment.create({
      data: {
        organizationId: orgId,
        clientId,
        programId: program.id,
        startLocalDate: first,
        weekdays: Array.from({ length: days }, (_, d) => d + 1),
        timezone: 'UTC',
      },
    });
    const sessionIds: string[] = [];
    for (let d = 0; d < days; d++) {
      const date = new Date(first.getTime() + d * 86_400_000);
      const s = await tx.workoutSession.create({
        data: {
          organizationId: orgId,
          assignmentId: assignment.id,
          clientId,
          slotWeekIndex: 0,
          slotDayIndex: d,
          scheduledLocalDate: date,
          scheduledAt: date,
          dueAt: new Date(date.getTime() + (23 * 60 + 59) * 60_000),
        },
      });
      sessionIds.push(s.id);
    }
    return {
      clientId,
      assignmentId: assignment.id,
      sessionIds,
      workoutVersionId: wv.id,
      exerciseIds: { bench: bench.id, plank: plank.id },
    };
  }, prisma);
}
