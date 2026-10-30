import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { toSetLogValue, type SetLogValue } from '../logging/values';
import { isUuid } from '../uuid';
import { fromDbDate } from './read';

/** The most exercise ids one history request may ask for (one workout holds at most 30 exercises). */
export const MAX_HISTORY_EXERCISES = 30;

export interface PreviousPerformance {
  /** The earlier session's client-local date. */
  localDate: string;
  sets: (Omit<SetLogValue, 'clientUpdatedAt'> & { setIndex: number })[];
}

/**
 * Per exerciseId: what the client logged for it in their most recent completed session (other than
 * `excludeSessionId`). One small lookup per distinct exercise (at most 30), so a rarely trained exercise is never
 * crowded out by frequent ones. Exercises never logged are absent from the result.
 */
export async function getExercisePerformance(
  tx: TenantTx,
  clientId: string,
  exerciseIds: string[],
  opts: { excludeSessionId?: string } = {},
): Promise<Record<string, PreviousPerformance>> {
  const previous: Record<string, PreviousPerformance> = {};
  for (const exerciseId of new Set(exerciseIds)) {
    const latest = await tx.setLog.findFirst({
      where: {
        ...(opts.excludeSessionId ? { sessionId: { not: opts.excludeSessionId } } : {}),
        session: { is: { clientId, state: 'completed' } },
        workoutVersionExercise: { is: { exerciseId } },
      },
      orderBy: [{ session: { completedAt: 'desc' } }, { sessionId: 'desc' }],
      select: {
        sessionId: true,
        workoutVersionExerciseId: true,
        session: { select: { scheduledLocalDate: true } },
      },
    });
    if (!latest) continue;
    const sets = await tx.setLog.findMany({
      // One exercise row: an exercise listed twice in that workout must not merge its sets.
      where: {
        sessionId: latest.sessionId,
        workoutVersionExerciseId: latest.workoutVersionExerciseId,
      },
      orderBy: [{ setIndex: 'asc' }],
    });
    previous[exerciseId] = {
      localDate: fromDbDate(latest.session.scheduledLocalDate),
      sets: sets.map((log) => {
        const v = toSetLogValue(log);
        return {
          setIndex: log.setIndex,
          reps: v.reps,
          weightKg: v.weightKg,
          rpe: v.rpe,
          durationSeconds: v.durationSeconds,
          distanceM: v.distanceM,
        };
      }),
    };
  }
  return previous;
}

const invalidIds = (message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { exerciseIds: [message] });

/** A coach's view of a client's last performance per exercise (the builder's "last time" hints). */
export async function getClientHistory(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  exerciseIds: string[],
): Promise<Record<string, PreviousPerformance>> {
  assertCan(actor, 'client:read');
  if (!isUuid(clientId)) throw new DomainError('NOT_FOUND', 'Not found.');
  const ids = [...new Set(exerciseIds.map((id) => id.toLowerCase()))];
  if (ids.length > MAX_HISTORY_EXERCISES) {
    throw invalidIds(`Use at most ${MAX_HISTORY_EXERCISES} exercise ids.`);
  }
  if (!ids.every((id) => isUuid(id))) throw invalidIds('Use exercise ids.');
  // The tenant scope hides another org's client: NOT_FOUND, never FORBIDDEN.
  const client = await tx.client.findFirst({ where: { id: clientId }, select: { id: true } });
  if (!client) throw new DomainError('NOT_FOUND', 'Not found.');
  return getExercisePerformance(tx, client.id, ids);
}
