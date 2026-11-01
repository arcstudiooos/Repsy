import { appendAudit, type Prisma, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';
import { sessionScope } from './read';

export const SWAP_REASONS = ['no_equipment', 'equipment_busy', 'preference', 'other'] as const;
export type SwapReason = (typeof SWAP_REASONS)[number];

export interface SwapView {
  /** The exercise done instead. */
  exerciseId: string;
  name: string;
  instructions: string;
  cues: string[];
  reason: SwapReason;
  /** The planned exercise it replaced. */
  plannedName: string;
  createdAt: string;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const conflict = (m: string) => new DomainError('CONFLICT', m);

/** Swaps in one session, keyed by workout-version exercise id. */
export async function swapsForSession(
  tx: TenantTx,
  sessionId: string,
): Promise<Record<string, SwapView>> {
  const rows = await tx.sessionExerciseSwap.findMany({
    where: { sessionId },
    select: {
      workoutVersionExerciseId: true,
      reason: true,
      createdAt: true,
      exercise: { select: { id: true, name: true, instructions: true, cues: true } },
      workoutVersionExercise: { select: { exercise: { select: { name: true } } } },
    },
  });
  return Object.fromEntries(
    rows.map((r) => [
      r.workoutVersionExerciseId,
      {
        exerciseId: r.exercise.id,
        name: r.exercise.name,
        instructions: r.exercise.instructions,
        cues: r.exercise.cues,
        reason: r.reason as SwapReason,
        plannedName: r.workoutVersionExercise.exercise.name,
        createdAt: r.createdAt.toISOString(),
      },
    ]),
  );
}

async function loadTarget(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: string,
  workoutVersionExerciseId: unknown,
) {
  if (!isUuid(sessionId) || !isUuid(workoutVersionExerciseId)) throw notFound();
  const session = await tx.workoutSession.findFirst({
    where: { id: sessionId, ...sessionScope(actor), state: { not: 'cancelled' } },
    select: { id: true, clientId: true, state: true, workoutVersionId: true },
  });
  if (!session) throw notFound();
  if (session.state !== 'in_progress' || !session.workoutVersionId) {
    throw conflict('Start the workout to swap an exercise.');
  }
  const wve = await tx.workoutVersionExercise.findFirst({
    where: { id: workoutVersionExerciseId, workoutVersionId: session.workoutVersionId },
    select: { id: true, exerciseId: true },
  });
  if (!wve) throw notFound();
  const logged = await tx.setLog.count({
    where: { sessionId: session.id, workoutVersionExerciseId: wve.id },
  });
  if (logged > 0)
    throw conflict('Sets are already logged for this exercise. Clear them to swap it.');
  return { session, wve };
}

/**
 * Does one of the coach's alternatives instead of a planned exercise in a started workout (PRD D8). Only before
 * any set of it is logged; the reason is one of a short list (no free text, nothing medical: D-007).
 */
export async function swapExercise(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: string,
  input: { workoutVersionExerciseId?: unknown; exerciseId?: unknown; reason?: unknown },
  opts: { requestId?: string } = {},
): Promise<SwapView> {
  assertCan(actor, 'session:log');
  if (!SWAP_REASONS.includes(input.reason as SwapReason)) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', { reason: ['Pick a reason.'] });
  }
  const { session, wve } = await loadTarget(tx, actor, sessionId, input.workoutVersionExerciseId);
  const allowed = await tx.exerciseAlternative.findFirst({
    where: {
      exerciseId: wve.exerciseId,
      alternativeExerciseId: typeof input.exerciseId === 'string' ? input.exerciseId : '',
    },
    select: { alternativeExerciseId: true },
  });
  if (!allowed || !isUuid(input.exerciseId)) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      exerciseId: ['Pick one of the alternatives your coach set.'],
    });
  }
  const data = {
    exerciseId: allowed.alternativeExerciseId,
    reason: input.reason as string,
    swappedByUserId: actor.userId,
  };
  await tx.sessionExerciseSwap.upsert({
    where: {
      sessionId_workoutVersionExerciseId: {
        sessionId: session.id,
        workoutVersionExerciseId: wve.id,
      },
    },
    create: {
      sessionId: session.id,
      workoutVersionExerciseId: wve.id,
      ...data,
    } as Prisma.SessionExerciseSwapUncheckedCreateInput,
    update: data,
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'workout_session',
    objectId: session.id,
    action: 'session.exercise_swapped',
    metadata: {
      workoutVersionExerciseId: wve.id,
      exerciseId: data.exerciseId,
      reason: data.reason,
    },
    requestId: opts.requestId,
  });
  return (await swapsForSession(tx, session.id))[wve.id]!;
}

/** Goes back to the planned exercise (only before any set of it is logged). */
export async function undoSwap(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: string,
  workoutVersionExerciseId: unknown,
  opts: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'session:log');
  const { session, wve } = await loadTarget(tx, actor, sessionId, workoutVersionExerciseId);
  const { count } = await tx.sessionExerciseSwap.deleteMany({
    where: { sessionId: session.id, workoutVersionExerciseId: wve.id },
  });
  if (count > 0) {
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'workout_session',
      objectId: session.id,
      action: 'session.exercise_swap_undone',
      metadata: { workoutVersionExerciseId: wve.id },
      requestId: opts.requestId,
    });
  }
}

/** One client's swaps, for crediting logged sets to the exercise actually done (records, history, PR badges). */
export interface ClientSwaps {
  /** The exercise performed for a logged set: the swap's exercise, else the planned one. */
  performed(sessionId: string, workoutVersionExerciseId: string, plannedExerciseId: string): string;
  /**
   * A set-log filter for sets performed as any of `exerciseIds`: planned as one of them and not swapped away, or
   * swapped to one of them.
   */
  where(exerciseIds: string[]): Prisma.SetLogWhereInput;
}

export async function loadClientSwaps(tx: TenantTx, clientId: string): Promise<ClientSwaps> {
  const rows = await tx.sessionExerciseSwap.findMany({
    where: { session: { is: { clientId } } },
    select: {
      sessionId: true,
      workoutVersionExerciseId: true,
      exerciseId: true,
      workoutVersionExercise: { select: { exerciseId: true } },
    },
  });
  const key = (s: string, w: string) => `${s}:${w}`;
  const byKey = new Map(rows.map((r) => [key(r.sessionId, r.workoutVersionExerciseId), r]));
  return {
    performed: (s, w, planned) => byKey.get(key(s, w))?.exerciseId ?? planned,
    where(exerciseIds) {
      const ids = new Set(exerciseIds);
      const plannedWhere: Prisma.SetLogWhereInput = {
        workoutVersionExercise: { is: { exerciseId: { in: [...ids] } } },
      };
      const away = rows.filter((r) => ids.has(r.workoutVersionExercise.exerciseId));
      const to = rows.filter((r) => ids.has(r.exerciseId));
      const pair = (r: (typeof rows)[number]) => ({
        sessionId: r.sessionId,
        workoutVersionExerciseId: r.workoutVersionExerciseId,
      });
      const planned: Prisma.SetLogWhereInput = away.length
        ? { AND: [plannedWhere, { NOT: { OR: away.map(pair) } }] }
        : plannedWhere;
      return to.length ? { OR: [planned, ...to.map(pair)] } : planned;
    },
  };
}
