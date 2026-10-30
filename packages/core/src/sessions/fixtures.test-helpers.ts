/**
 * Test fixtures shared by the sessions, logging and review tests (not a test file itself: no `.test.` in the name).
 * Builds an org with a coach, active clients and a template assigned through the real `assignProgram`.
 */
import { createHash } from 'node:crypto';
import { withSystem, withTenant, type PrismaClient, type TenantTx } from '@kinetic/db';
import { assignProgram } from '../assignments/assign';
import type { ActorContext } from '../authz/actor';
import { commitProgramVersion, type WeekInput } from '../programs/commit';
import { createProgram } from '../programs/read';

export const BENCH = 'e0000000-0000-4000-8000-000000000001';
/** Incline Dumbbell Press (catalog slot 2, reps/load). */
export const PRESS = 'e0000000-0000-4000-8000-000000000002';
export const NY = 'America/New_York';
/** Wednesday 2026-11-04 08:00 in New York. */
export const NOW = new Date('2026-11-04T13:00:00Z');

export const grid = (weeks: number, days: number, prefix = 'W'): WeekInput[] =>
  Array.from({ length: weeks }, (_, w) => ({
    days: Array.from({ length: days }, (_, d) => ({
      title: `${prefix}${w + 1}D${d + 1}`,
      exercises: [
        {
          exerciseId: BENCH,
          sets: [
            { reps: 8, loadKg: 60 },
            { reps: 8, loadKg: 60 },
          ],
        },
        { exerciseId: PRESS, sets: [{ reps: 5, loadKg: 100 }] },
      ],
    })),
  }));

export interface Org {
  orgId: string;
  coach: ActorContext;
}

export interface ClientWorld extends Org {
  clientId: string;
  userId: string;
  /** The client acting in the portal. */
  client: ActorContext;
  assignmentId: string;
  clientProgramId: string;
  templateId: string;
}

export function runAs<T>(
  prisma: PrismaClient,
  actor: ActorContext,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return withTenant(actor.orgId, fn, prisma, { userId: actor.userId });
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export async function newOrg(prisma: PrismaClient, timezone = NY): Promise<Org> {
  const { orgId, coachId } = await withSystem(async (tx) => {
    const coach = await tx.user.create({
      data: { email: `coach-${uniq()}@example.test`, name: 'Coach' },
    });
    const org = await tx.organization.create({
      data: { name: 'Org', timezone, ownerUserId: coach.id },
    });
    await tx.membership.create({
      data: { userId: coach.id, organizationId: org.id, role: 'owner' },
    });
    return { orgId: org.id, coachId: coach.id };
  }, prisma);
  return {
    orgId,
    coach: { userId: coachId, orgId, role: 'owner', isPlatformAdmin: false },
  };
}

/** An active, linked client in `org` with `weeks` assigned on `weekdays` from `startLocalDate`. */
export async function newClientWorld(
  prisma: PrismaClient,
  org: Org,
  opts: {
    weeks?: WeekInput[];
    weekdays?: (1 | 2 | 3 | 4 | 5 | 6 | 7)[];
    startLocalDate?: string;
    timezone?: string;
    now?: Date;
  } = {},
): Promise<ClientWorld> {
  const timezone = opts.timezone ?? NY;
  const { clientId, userId } = await withSystem(async (tx) => {
    const user = await tx.user.create({
      data: { email: `client-${uniq()}@example.test`, name: 'Client' },
    });
    await tx.membership.create({
      data: { userId: user.id, organizationId: org.orgId, role: 'client' },
    });
    const c = await tx.client.create({
      data: {
        organizationId: org.orgId,
        userId: user.id,
        coachUserId: org.coach.userId,
        name: 'Client',
        email: user.email,
        status: 'active',
        timezone,
      },
    });
    return { clientId: c.id, userId: user.id };
  }, prisma);
  const weeks = opts.weeks ?? grid(1, 3);
  const { id: templateId } = await runAs(prisma, org.coach, (tx) =>
    createProgram(tx, org.coach, { title: 'Block' }),
  );
  await runAs(prisma, org.coach, (tx) =>
    commitProgramVersion(tx, org.coach, { programId: templateId, expectedVersionNo: null, weeks }),
  );
  const res = await runAs(prisma, org.coach, (tx) =>
    assignProgram(
      tx,
      org.coach,
      {
        clientId,
        templateProgramId: templateId,
        startLocalDate: opts.startLocalDate ?? '2026-11-04',
        weekdays: opts.weekdays ?? [1, 3, 5],
        readinessConfirmed: true,
        confirmReplace: false,
      },
      { now: opts.now ?? NOW },
    ),
  );
  return {
    ...org,
    clientId,
    userId,
    client: { userId, orgId: org.orgId, role: 'client', isPlatformAdmin: false, clientId },
    assignmentId: res.assignmentId,
    clientProgramId: res.clientProgramId,
    templateId,
  };
}

/**
 * Commits a new version of a client copy directly (the builder edits templates only until S3-2): every slot of the
 * current version is copied, and slot (0,0) gets a new workout titled `title`. Returns the new workout version id.
 */
export async function commitClientCopyVersion(
  prisma: PrismaClient,
  w: ClientWorld,
  title: string,
): Promise<string> {
  return withSystem(async (tx) => {
    const program = await tx.program.findUniqueOrThrow({ where: { id: w.clientProgramId } });
    const current = await tx.programVersion.findUniqueOrThrow({
      where: { id: program.currentVersionId ?? '' },
      include: { slots: true },
    });
    const wv = await tx.workoutVersion.create({
      data: {
        organizationId: w.orgId,
        title,
        contentHash: createHash('sha256').update(title).digest('hex'),
      },
    });
    await tx.workoutVersionExercise.create({
      data: {
        organizationId: w.orgId,
        workoutVersionId: wv.id,
        exerciseId: PRESS,
        position: 0,
        targetJson: [{ reps: 3, loadKg: 120 }],
      },
    });
    const next = await tx.programVersion.create({
      data: {
        organizationId: w.orgId,
        programId: program.id,
        versionNo: current.versionNo + 1,
        committedBy: w.coach.userId,
        daysPerWeek: current.daysPerWeek,
        weekCount: current.weekCount,
      },
    });
    await tx.programSlot.createMany({
      data: current.slots.map((s) => ({
        organizationId: w.orgId,
        programVersionId: next.id,
        weekIndex: s.weekIndex,
        dayIndex: s.dayIndex,
        workoutVersionId: s.weekIndex === 0 && s.dayIndex === 0 ? wv.id : s.workoutVersionId,
      })),
    });
    await tx.program.update({ where: { id: program.id }, data: { currentVersionId: next.id } });
    return wv.id;
  }, prisma);
}

export const sessionsOf = (prisma: PrismaClient, assignmentId: string) =>
  withSystem(
    (tx) =>
      tx.workoutSession.findMany({
        where: { assignmentId },
        orderBy: [{ slotWeekIndex: 'asc' }, { slotDayIndex: 'asc' }],
      }),
    prisma,
  );
