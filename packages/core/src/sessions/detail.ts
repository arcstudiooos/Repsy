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
    // Cancelled sessions are never shown (D-002 #7).
    where: { id: sessionId, ...sessionScope(actor), state: { not: 'cancelled' } },
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

  // Per exercise, the client's most recent other completed session that logged it, then that session's sets.
  // One small lookup per distinct exercise (at most 30 per workout), so a rarely trained exercise is never crowded
  // out by frequent ones.
  const exerciseIds = [...new Set(workout.exercises.map((e) => e.exerciseId))];
  const previous: Record<string, PreviousPerformance> = {};
  for (const exerciseId of exerciseIds) {
    const latest = await tx.setLog.findFirst({
      where: {
        sessionId: { not: row.id },
        session: { is: { clientId: row.clientId, state: 'completed' } },
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
