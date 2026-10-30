import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { toSetLogValue, type SetLogValue } from '../logging/values';
import type { Units } from '../units';
import { isUuid } from '../uuid';
import { fromDbDate, sessionScope, summarize, SUMMARY_SELECT } from './read';
import { resolveSessionWorkout } from './resolve';
import type { SessionSummary, WorkoutVersionView } from './types';

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

export type LoggedSet = SetLogValue & { workoutVersionExerciseId: string; setIndex: number };

export interface PreviousPerformance {
  /** The earlier session's client-local date. */
  localDate: string;
  sets: (Omit<SetLogValue, 'clientUpdatedAt'> & { setIndex: number })[];
}

export interface SessionDetail {
  session: SessionSummary & { comment: string | null; workoutVersionId: string | null };
  workout: WorkoutVersionView;
  logs: LoggedSet[];
  /** Per exerciseId: what the client logged for it in their most recent other completed session. */
  previous: Record<string, PreviousPerformance>;
  client: { id: string; name: string; preferredUnits: Units };
}

/** Everything the logging screen needs for one session (S2-2), for the client themselves or their coach. */
export async function getSessionDetail(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: string,
  opts: { now?: Date } = {},
): Promise<SessionDetail> {
  assertCan(actor, 'session:read');
  if (!isUuid(sessionId)) throw notFound();
  const now = opts.now ?? new Date();
  const row = await tx.workoutSession.findFirst({
    where: { id: sessionId, ...sessionScope(actor) },
    select: { ...SUMMARY_SELECT, comment: true },
  });
  if (!row) throw notFound();
  const [summary] = await summarize(tx, [row], now);
  const workout = await resolveSessionWorkout(tx, row.id);
  const client = await tx.client.findFirst({
    where: { id: row.clientId },
    select: { id: true, name: true, preferredUnits: true },
  });
  if (!summary || !client) throw notFound();

  const logs = await tx.setLog.findMany({
    where: { sessionId: row.id },
    orderBy: [{ workoutVersionExerciseId: 'asc' }, { setIndex: 'asc' }],
  });

  const exerciseIds = [...new Set(workout.exercises.map((e) => e.exerciseId))];
  const earlier = exerciseIds.length
    ? await tx.setLog.findMany({
        where: {
          sessionId: { not: row.id },
          session: { is: { clientId: row.clientId, state: 'completed' } },
          workoutVersionExercise: { is: { exerciseId: { in: exerciseIds } } },
        },
        orderBy: [{ session: { completedAt: 'desc' } }, { setIndex: 'asc' }],
        take: 500,
        select: {
          sessionId: true,
          setIndex: true,
          reps: true,
          weightKg: true,
          rpe: true,
          durationSeconds: true,
          distanceM: true,
          clientUpdatedAt: true,
          session: { select: { scheduledLocalDate: true } },
          workoutVersionExercise: { select: { exerciseId: true } },
        },
      })
    : [];
  const previous: Record<string, PreviousPerformance> = {};
  const fromSession: Record<string, string> = {};
  for (const log of earlier) {
    const exerciseId = log.workoutVersionExercise.exerciseId;
    // Rows come newest session first: the first session seen for an exercise is the one shown.
    fromSession[exerciseId] ??= log.sessionId;
    if (fromSession[exerciseId] !== log.sessionId) continue;
    const entry = (previous[exerciseId] ??= {
      localDate: fromDbDate(log.session.scheduledLocalDate),
      sets: [],
    });
    const v = toSetLogValue(log);
    entry.sets.push({
      setIndex: log.setIndex,
      reps: v.reps,
      weightKg: v.weightKg,
      rpe: v.rpe,
      durationSeconds: v.durationSeconds,
      distanceM: v.distanceM,
    });
  }

  return {
    session: { ...summary, comment: row.comment, workoutVersionId: row.workoutVersionId },
    workout,
    logs: logs.map((l) => ({
      workoutVersionExerciseId: l.workoutVersionExerciseId,
      setIndex: l.setIndex,
      ...toSetLogValue(l),
    })),
    previous,
    client,
  };
}
