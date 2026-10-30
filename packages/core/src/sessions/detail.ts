import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { EDIT_WINDOW_MS } from '../logging/schema';
import { toSetLogValue, type RevisionValues, type SetLogValue } from '../logging/values';
import type { Units } from '../units';
import { isUuid } from '../uuid';
import { getExercisePerformance, type PreviousPerformance } from './history';
import { sessionScope, summarize, SUMMARY_SELECT } from './read';
import { resolveSessionWorkout } from './resolve';
import type { SessionSummary, WorkoutVersionView } from './types';

export type { PreviousPerformance };

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

export type LoggedSet = SetLogValue & { workoutVersionExerciseId: string; setIndex: number };

/** One change to a set after the workout was finished (S3-4), oldest first. */
export interface SetLogRevisionView {
  workoutVersionExerciseId: string;
  setIndex: number;
  /** Null when the change created the set. */
  before: RevisionValues | null;
  after: RevisionValues;
  /** A coach's reason, shown to coaches only (Ruling 5): always null for a client actor. */
  reason: string | null;
  revisedByName: string;
  role: 'client' | 'coach';
  createdAt: string;
}

export interface SessionDetail {
  session: SessionSummary & { comment: string | null; workoutVersionId: string | null };
  workout: WorkoutVersionView;
  logs: LoggedSet[];
  /** Per exerciseId: what the client logged for it in their most recent other completed session. */
  previous: Record<string, PreviousPerformance>;
  client: { id: string; name: string; preferredUnits: Units; timezone: string };
  revisions: SetLogRevisionView[];
  /** Client actors on a completed or skipped session: when their edit window closes (`submittedAt` + 24h). */
  editableUntil: string | null;
}

const values = (json: unknown): RevisionValues => {
  const v = (json ?? {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' ? x : null);
  return {
    reps: n(v.reps),
    weightKg: n(v.weightKg),
    rpe: n(v.rpe),
    durationSeconds: n(v.durationSeconds),
    distanceM: n(v.distanceM),
  };
};

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
    select: { ...SUMMARY_SELECT, comment: true, submittedAt: true },
  });
  if (!row) throw notFound();
  const [summary] = await summarize(tx, [row], now);
  const workout = await resolveSessionWorkout(tx, row.id);
  const client = await tx.client.findFirst({
    where: { id: row.clientId },
    select: { id: true, name: true, preferredUnits: true, timezone: true },
  });
  if (!summary || !client) throw notFound();

  const logs = await tx.setLog.findMany({
    where: { sessionId: row.id },
    orderBy: [{ workoutVersionExerciseId: 'asc' }, { setIndex: 'asc' }],
  });

  const revisionRows = await tx.setLogRevision.findMany({
    where: { sessionId: row.id },
    orderBy: [
      { createdAt: 'asc' },
      { setLog: { workoutVersionExerciseId: 'asc' } },
      { setLog: { setIndex: 'asc' } },
    ],
    select: {
      beforeJson: true,
      afterJson: true,
      reason: true,
      revisedBy: true,
      revisedByRole: true,
      createdAt: true,
      setLog: { select: { workoutVersionExerciseId: true, setIndex: true } },
    },
  });
  // Users are readable within the org (users RLS); someone who has since left falls back to their role.
  const names = new Map(
    (
      await tx.user.findMany({
        where: { id: { in: [...new Set(revisionRows.map((r) => r.revisedBy))] } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name]),
  );
  const isClient = actor.role === 'client';
  const revisions: SetLogRevisionView[] = revisionRows.map((r) => ({
    workoutVersionExerciseId: r.setLog.workoutVersionExerciseId,
    setIndex: r.setLog.setIndex,
    before: r.beforeJson === null ? null : values(r.beforeJson),
    after: values(r.afterJson),
    reason: isClient ? null : r.reason,
    revisedByName: names.get(r.revisedBy) ?? (r.revisedByRole === 'client' ? client.name : 'Coach'),
    role: r.revisedByRole,
    createdAt: r.createdAt.toISOString(),
  }));
  const editableUntil =
    isClient && (row.state === 'completed' || row.state === 'skipped') && row.submittedAt
      ? new Date(row.submittedAt.getTime() + EDIT_WINDOW_MS).toISOString()
      : null;

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
    revisions,
    editableUntil,
  };
}
