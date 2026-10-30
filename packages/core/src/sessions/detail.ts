import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { toSetLogValue, type SetLogValue } from '../logging/values';
import type { Units } from '../units';
import { isUuid } from '../uuid';
import { getExercisePerformance, type PreviousPerformance } from './history';
import { sessionScope, summarize, SUMMARY_SELECT } from './read';
import { resolveSessionWorkout } from './resolve';
import type { SessionSummary, WorkoutVersionView } from './types';

export type { PreviousPerformance };

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

export type LoggedSet = SetLogValue & { workoutVersionExerciseId: string; setIndex: number };

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

  const previous = await getExercisePerformance(
    tx,
    row.clientId,
    workout.exercises.map((e) => e.exerciseId),
    { excludeSessionId: row.id },
  );

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
