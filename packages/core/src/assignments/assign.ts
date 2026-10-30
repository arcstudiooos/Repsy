import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';
import { scheduleSlots, ScheduleInputError } from '../schedule/scheduleSlots';
import { todayInZone } from '../timezone';
import type { IsoWeekday } from '../schedule/types';

export interface AssignProgramInput {
  clientId: string;
  templateProgramId: string;
  /** YYYY-MM-DD in the client timezone. */
  startLocalDate: string;
  weekdays: IsoWeekday[];
  readinessConfirmed: boolean;
  confirmReplace: boolean;
}

export interface AssignProgramResult {
  assignmentId: string;
  clientProgramId: string;
  sessionCount: number;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const activeExists = () =>
  new DomainError(
    'ACTIVE_ASSIGNMENT_EXISTS',
    'This client already has an active program. Confirm to replace it.',
  );

/** Maps a scheduling failure to the request field it is about. */
function scheduleError(error: ScheduleInputError): DomainError {
  const m = error.message;
  const field = m.includes('startLocalDate')
    ? 'startLocalDate'
    : m.includes('weekday')
      ? 'weekdays'
      : 'timezone';
  return invalid(field, m);
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';

const toDbDate = (localDate: string): Date => new Date(`${localDate}T00:00:00.000Z`);
const fromDbDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Assigns a template to a client (D-001 copy-on-assign, D-002 #4, D-010 #2).
 * The client row is locked first so concurrent assigns for one client run one at a time; the partial unique index
 * on active assignments backstops it. Workout versions are shared with the template, never copied.
 */
export async function assignProgram(
  tx: TenantTx,
  actor: ActorContext,
  input: AssignProgramInput,
  opts: { requestId?: string; now?: Date } = {},
): Promise<AssignProgramResult> {
  assertCan(actor, 'assignment:write');
  const { clientId, templateProgramId, startLocalDate, weekdays } = input;
  if (!isUuid(clientId) || !isUuid(templateProgramId)) throw notFound();

  // No raw SQL in TenantTx: a no-op UPDATE takes the same row lock as SELECT ... FOR UPDATE until the tx ends.
  const locked = await tx.client.updateMany({
    where: { id: clientId },
    data: { updatedAt: new Date() },
  });
  if (locked.count === 0) throw notFound();
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, status: true, timezone: true },
  });
  if (!client) throw notFound();
  if (client.status !== 'active') {
    throw new DomainError('CONFLICT', 'Programs can only be assigned to active clients.');
  }

  const template = await tx.program.findFirst({
    where: { id: templateProgramId, kind: 'template' },
    select: { id: true, title: true, currentVersionId: true },
  });
  if (!template) throw notFound();
  if (template.currentVersionId === null) {
    throw invalid('templateProgramId', 'Save the program before assigning it.');
  }
  const version = await tx.programVersion.findFirst({
    where: { id: template.currentVersionId },
    select: { id: true, daysPerWeek: true, weekCount: true },
  });
  if (!version) throw notFound();
  const templateSlots = await tx.programSlot.findMany({
    where: { programVersionId: version.id },
    orderBy: [{ weekIndex: 'asc' }, { dayIndex: 'asc' }],
    select: { weekIndex: true, dayIndex: true, workoutVersionId: true },
  });

  const active = await tx.programAssignment.findFirst({
    where: { clientId, status: 'active' },
    select: { id: true },
  });
  if (active && !input.confirmReplace) throw activeExists();
  if (!active && !input.readinessConfirmed) {
    const prior = await tx.programAssignment.count({ where: { clientId } });
    if (prior === 0) {
      throw invalid('readinessConfirmed', 'Confirm the client is ready to start this program.');
    }
  }

  let scheduled;
  try {
    scheduled = scheduleSlots({
      slots: templateSlots.map((s) => ({ weekIndex: s.weekIndex, dayIndex: s.dayIndex })),
      weekdays,
      startLocalDate,
      timeZone: client.timezone,
    });
  } catch (error) {
    if (error instanceof ScheduleInputError) throw scheduleError(error);
    throw error;
  }
  // A back-dated start would create already-due sessions and, on replacement, cancel past scheduled sessions that
  // are about to become missed history. Compared as YYYY-MM-DD strings (validated above) in the client's zone.
  if (startLocalDate < todayInZone(client.timezone, opts.now ?? new Date())) {
    throw invalid('startLocalDate', "Start date can't be in the past.");
  }

  let cancelledSessions = 0;
  if (active) {
    await tx.programAssignment.updateMany({
      where: { id: active.id },
      data: { status: 'ended', endedAt: new Date() },
    });
    // Only never-started sessions: in_progress, completed and skipped history stays as it is (D-010 #2).
    const cancelled = await tx.workoutSession.updateMany({
      where: {
        assignmentId: active.id,
        state: 'scheduled',
        scheduledLocalDate: { gte: toDbDate(startLocalDate) },
      },
      data: { state: 'cancelled' },
    });
    cancelledSessions = cancelled.count;
  }

  // Scalar FKs only: the tenant extension injects scalar organizationId.
  const copy = await tx.program.create({
    data: {
      title: template.title,
      kind: 'client',
      clientId,
      sourceProgramId: template.id,
      sourceVersionId: version.id,
      createdBy: actor.userId,
    },
  } as Parameters<typeof tx.program.create>[0]);
  const copyVersion = await tx.programVersion.create({
    data: {
      programId: copy.id,
      versionNo: 1,
      committedBy: actor.userId,
      daysPerWeek: version.daysPerWeek,
      weekCount: version.weekCount,
    },
  } as Parameters<typeof tx.programVersion.create>[0]);
  await tx.programSlot.createMany({
    data: templateSlots.map((s) => ({ ...s, programVersionId: copyVersion.id })),
  } as Parameters<typeof tx.programSlot.createMany>[0]);
  await tx.program.updateMany({
    where: { id: copy.id },
    data: { currentVersionId: copyVersion.id },
  });

  let assignment;
  try {
    assignment = await tx.programAssignment.create({
      data: {
        clientId,
        programId: copy.id,
        startLocalDate: toDbDate(startLocalDate),
        weekdays,
        timezone: client.timezone,
        readinessConfirmedAt: input.readinessConfirmed ? new Date() : null,
        readinessConfirmedBy: input.readinessConfirmed ? actor.userId : null,
      },
    } as Parameters<typeof tx.programAssignment.create>[0]);
  } catch (error) {
    if (isUniqueViolation(error)) throw activeExists();
    throw error;
  }

  await tx.workoutSession.createMany({
    data: scheduled.map((s) => ({
      assignmentId: assignment.id,
      clientId,
      slotWeekIndex: s.slot.weekIndex,
      slotDayIndex: s.slot.dayIndex,
      scheduledLocalDate: toDbDate(s.localDate),
      scheduledAt: s.scheduledAtUtc,
      dueAt: s.dueAtUtc,
    })),
  } as Parameters<typeof tx.workoutSession.createMany>[0]);

  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'assignment',
    objectId: assignment.id,
    action: 'assignment.created',
    metadata: {
      clientId,
      programId: copy.id,
      sessionCount: scheduled.length,
      // D-007: the coach's readiness confirmation is audited with the assignment it was given for.
      ...(input.readinessConfirmed ? { readinessConfirmed: true } : {}),
    },
    requestId: opts.requestId,
  });
  if (active) {
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'assignment',
      objectId: active.id,
      action: 'assignment.replaced',
      metadata: { clientId, replacedBy: assignment.id, cancelledSessions },
      requestId: opts.requestId,
    });
  }
  return { assignmentId: assignment.id, clientProgramId: copy.id, sessionCount: scheduled.length };
}

export interface AssignmentSummary {
  assignmentId: string;
  programTitle: string;
  startLocalDate: string;
  weekdays: IsoWeekday[];
  /** Sessions still part of the plan (cancelled ones excluded). */
  sessionCount: number;
  nextSession: { localDate: string; title: string } | null;
}

/** The client active assignment, or null. `opts.now` exists for tests. */
export async function getAssignmentSummary(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  opts: { now?: Date } = {},
): Promise<AssignmentSummary | null> {
  assertCan(actor, 'assignment:read');
  if (!isUuid(clientId)) throw notFound();
  const client = await tx.client.findFirst({ where: { id: clientId }, select: { id: true } });
  if (!client) throw notFound();

  const assignment = await tx.programAssignment.findFirst({
    where: { clientId, status: 'active' },
    include: { program: { select: { title: true, currentVersionId: true } } },
  });
  if (!assignment) return null;

  const sessionCount = await tx.workoutSession.count({
    where: { assignmentId: assignment.id, state: { not: 'cancelled' } },
  });
  const order = [
    { dueAt: 'asc' as const },
    { slotWeekIndex: 'asc' as const },
    { slotDayIndex: 'asc' as const },
  ];
  // A started session is the one to finish next, even when it is overdue; otherwise the next one still due.
  const next =
    (await tx.workoutSession.findFirst({
      where: { assignmentId: assignment.id, state: 'in_progress' },
      orderBy: order,
    })) ??
    (await tx.workoutSession.findFirst({
      where: {
        assignmentId: assignment.id,
        state: { in: ['scheduled', 'in_progress'] },
        dueAt: { gte: opts.now ?? new Date() },
      },
      orderBy: order,
    }));

  let nextSession: AssignmentSummary['nextSession'] = null;
  if (next) {
    // Unstarted sessions resolve late (D-002 #5); a locked session keeps its own version.
    const workout = next.workoutVersionId
      ? await tx.workoutVersion.findFirst({
          where: { id: next.workoutVersionId },
          select: { title: true },
        })
      : (
          await tx.programSlot.findFirst({
            where: {
              programVersionId: assignment.program.currentVersionId ?? '',
              weekIndex: next.slotWeekIndex,
              dayIndex: next.slotDayIndex,
            },
            select: { workoutVersion: { select: { title: true } } },
          })
        )?.workoutVersion;
    nextSession = { localDate: fromDbDate(next.scheduledLocalDate), title: workout?.title ?? '' };
  }
  return {
    assignmentId: assignment.id,
    programTitle: assignment.program.title,
    startLocalDate: fromDbDate(assignment.startLocalDate),
    weekdays: assignment.weekdays as IsoWeekday[],
    sessionCount,
    nextSession,
  };
}
