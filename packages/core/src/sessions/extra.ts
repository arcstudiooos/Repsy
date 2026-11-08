import { appendAudit, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { escapeLike } from '../clients/clients';
import { DomainError } from '../errors';
import type { TrackingType } from '../exercises/options';
import { contentHash, TITLE_MAX } from '../programs/commit';
import { localDayBounds } from '../schedule/scheduleSlots';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';
import { toDbDate } from './read';

/**
 * Extra workouts (PRD D13): a client logs an unplanned session, either from a blank list of exercises they pick or
 * from a workout their coach shares (a day of a template marked "shared with clients"). It is a workout_session of
 * kind `extra`: no assignment or slot, its workout version fixed at the start, dated today in the client's zone. It
 * shows in history, records and the coach's review, and never in adherence, compliance or weekly counts.
 */

export const EXTRA_MAX_EXERCISES = 20;
/** Blank set rows each picked exercise starts with; the logger adds more. */
const BLANK_SETS = 3;
const SHARED_MAX = 100;

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

function clientOnly(actor: ActorContext): string {
  if (actor.role !== 'client' || !actor.clientId) {
    throw new DomainError('FORBIDDEN', 'Only clients start extra workouts.');
  }
  return actor.clientId;
}

export interface SharedWorkout {
  workoutVersionId: string;
  title: string;
  programTitle: string;
  exercises: string[];
}

/** Workouts the coach shares: each distinct day of every active template shared with clients. */
export async function listSharedWorkouts(
  tx: TenantTx,
  actor: ActorContext,
): Promise<SharedWorkout[]> {
  assertCan(actor, 'session:log');
  clientOnly(actor);
  const programs = await tx.program.findMany({
    where: {
      kind: 'template',
      status: 'active',
      sharedWithClients: true,
      currentVersionId: { not: null },
    },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
    select: { title: true, currentVersionId: true },
  });
  const out: SharedWorkout[] = [];
  const seen = new Set<string>();
  for (const p of programs) {
    const slots = await tx.programSlot.findMany({
      where: { programVersionId: p.currentVersionId! },
      orderBy: [{ weekIndex: 'asc' }, { dayIndex: 'asc' }],
      select: {
        workoutVersion: {
          select: {
            id: true,
            title: true,
            exercises: {
              orderBy: { position: 'asc' },
              select: { exercise: { select: { name: true } } },
            },
          },
        },
      },
    });
    for (const { workoutVersion: wv } of slots) {
      if (seen.has(wv.id)) continue;
      seen.add(wv.id);
      out.push({
        workoutVersionId: wv.id,
        title: wv.title,
        programTitle: p.title,
        exercises: wv.exercises.map((e) => e.exercise.name),
      });
      if (out.length >= SHARED_MAX) return out;
    }
  }
  return out;
}

export interface ExtraExerciseOption {
  id: string;
  name: string;
  trackingType: TrackingType;
  equipment: string;
}

/** The exercise library (catalog and this workspace's own), for a client building a blank extra workout. */
export async function searchExtraExercises(
  tx: TenantTx,
  actor: ActorContext,
  q: unknown,
): Promise<ExtraExerciseOption[]> {
  assertCan(actor, 'session:log');
  clientOnly(actor);
  const text = typeof q === 'string' ? q.trim() : '';
  if (text.length > 100) throw invalid('q', 'Use at most 100 characters.');
  const rows = await tx.exercise.findMany({
    where: text ? { name: { contains: escapeLike(text), mode: 'insensitive' } } : {},
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 20,
    select: { id: true, name: true, trackingType: true, equipment: true },
  });
  return rows;
}

/**
 * Starts an extra workout for the signed-in client and returns its session id. Give `workoutVersionId` (a shared
 * workout) or `exerciseIds` (1-20, in order) with an optional `title`. One extra workout can be open at a time.
 */
export async function startExtraWorkout(
  tx: TenantTx,
  actor: ActorContext,
  input: { workoutVersionId?: unknown; exerciseIds?: unknown; title?: unknown },
  opts: { now?: Date; requestId?: string } = {},
): Promise<{ sessionId: string }> {
  assertCan(actor, 'session:log');
  const clientId = clientOnly(actor);
  const now = opts.now ?? new Date();
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, status: true, timezone: true },
  });
  if (!client) throw notFound();
  if (client.status === 'archived') {
    throw new DomainError('CONFLICT', 'This account is archived, so new workouts can’t be logged.');
  }
  const open = await tx.workoutSession.findFirst({
    where: { clientId, kind: 'extra', state: 'in_progress' },
    select: { id: true },
  });
  if (open) {
    throw new DomainError('CONFLICT', 'Finish the extra workout you already started first.', {
      sessionId: [open.id],
    });
  }

  let workoutVersionId: string;
  let source: 'shared' | 'blank';
  if (input.workoutVersionId !== undefined) {
    if (!isUuid(input.workoutVersionId)) throw notFound();
    const shared = await tx.programSlot.findFirst({
      where: {
        workoutVersionId: input.workoutVersionId,
        programVersion: {
          currentOf: { is: { kind: 'template', status: 'active', sharedWithClients: true } },
        },
      },
      select: { workoutVersionId: true },
    });
    if (!shared) throw notFound();
    workoutVersionId = shared.workoutVersionId;
    source = 'shared';
  } else {
    const ids = input.exerciseIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      throw invalid('exerciseIds', 'Pick at least one exercise.');
    }
    if (ids.length > EXTRA_MAX_EXERCISES) {
      throw invalid('exerciseIds', `Pick at most ${EXTRA_MAX_EXERCISES} exercises.`);
    }
    if (!ids.every(isUuid)) throw invalid('exerciseIds', 'Pick exercises from the list.');
    const wanted = ids.map((id) => (id as string).toLowerCase());
    const found = await tx.exercise.count({ where: { id: { in: [...new Set(wanted)] } } });
    if (found !== new Set(wanted).size)
      throw invalid('exerciseIds', 'Pick exercises from the list.');
    const rawTitle = typeof input.title === 'string' ? input.title.trim() : '';
    if (rawTitle.length > TITLE_MAX) throw invalid('title', `Use at most ${TITLE_MAX} characters.`);
    const workout = {
      title: rawTitle || 'Extra workout',
      notes: '',
      exercises: wanted.map((exerciseId) => ({
        exerciseId,
        note: null,
        sets: Array.from({ length: BLANK_SETS }, () => ({})),
      })),
    };
    const hash = contentHash(workout);
    // Workout versions are immutable, so identical content is shared.
    const existing = await tx.workoutVersion.findFirst({
      where: { contentHash: hash },
      select: { id: true },
    });
    if (existing) workoutVersionId = existing.id;
    else {
      const row = await tx.workoutVersion.create({
        data: { title: workout.title, notes: '', contentHash: hash },
      } as Parameters<typeof tx.workoutVersion.create>[0]);
      await tx.workoutVersionExercise.createMany({
        data: workout.exercises.map((e, position) => ({
          workoutVersionId: row.id,
          exerciseId: e.exerciseId,
          position,
          targetJson: e.sets,
        })),
      } as unknown as Parameters<typeof tx.workoutVersionExercise.createMany>[0]);
      workoutVersionId = row.id;
    }
    source = 'blank';
  }

  const today = todayInZone(client.timezone, now);
  const { scheduledAtUtc, dueAtUtc } = localDayBounds(today, client.timezone);
  const session = await tx.workoutSession.create({
    data: {
      clientId,
      kind: 'extra',
      scheduledLocalDate: toDbDate(today),
      scheduledAt: scheduledAtUtc,
      dueAt: dueAtUtc,
      state: 'in_progress',
      startedAt: now,
      workoutVersionId,
    },
  } as Parameters<typeof tx.workoutSession.create>[0]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'workout_session',
    objectId: session.id,
    action: 'session.extra_started',
    metadata: { clientId, source },
    requestId: opts.requestId,
  });
  return { sessionId: session.id };
}

/** Shares a template with clients as extra workouts, or stops sharing it. */
export async function setProgramShared(
  tx: TenantTx,
  actor: ActorContext,
  programId: unknown,
  shared: unknown,
  opts: { requestId?: string } = {},
): Promise<{ sharedWithClients: boolean }> {
  assertCan(actor, 'program:write');
  if (!isUuid(programId)) throw notFound();
  if (typeof shared !== 'boolean') throw invalid('sharedWithClients', 'Use true or false.');
  const program = await tx.program.findFirst({
    where: { id: programId },
    select: { id: true, kind: true },
  });
  if (!program) throw notFound();
  if (program.kind !== 'template') {
    throw invalid('sharedWithClients', 'Only templates can be shared with clients.');
  }
  await tx.program.update({ where: { id: program.id }, data: { sharedWithClients: shared } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'program',
    objectId: program.id,
    action: shared ? 'program.shared_with_clients' : 'program.unshared_with_clients',
    metadata: {},
    requestId: opts.requestId,
  });
  return { sharedWithClients: shared };
}
