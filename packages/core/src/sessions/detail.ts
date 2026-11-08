import { readReadiness, type ReadinessView } from './readiness';
import { formChecksFor, type FormCheckView } from './formChecks';
import type { TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { EDIT_WINDOW_MS } from '../logging/schema';
import { toSetLogValue, type RevisionValues, type SetLogValue } from '../logging/values';
import type { Units } from '../units';
import { isUuid } from '../uuid';
import { alternativesFor, type AlternativeView } from '../exercises/alternatives';
import { exerciseBestsBefore, type ExerciseBest } from '../progress/records';
import { getExercisePerformance, type PreviousPerformance } from './history';
import { sessionScope, summarize, SUMMARY_SELECT } from './read';
import { resolveSessionWorkout } from './resolve';
import { notesForSession, type SessionNoteView } from './notes';
import { swapsForSession, type SwapView } from './swaps';
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
  /** Per exerciseId: the client's bests from other completed sessions, for PR badges (PRD D11). */
  bests?: Record<string, ExerciseBest>;
  /** Per workout-version exercise id: the alternative done instead (PRD D8). */
  swaps?: Record<string, SwapView>;
  /** Per planned exerciseId: the coach's alternatives (PRD C4), for the swap menu. */
  alternatives?: Record<string, AlternativeView[]>;
  /** Notes on exercises and sets by the client and coach, oldest first (PRD D9). */
  notes?: SessionNoteView[];
  client: { id: string; name: string; preferredUnits: Units; timezone: string };
  revisions: SetLogRevisionView[];
  /** Client actors on a completed or skipped session: when their edit window closes (`submittedAt` + 24h). */
  editableUntil: string | null;
  /** PRD D17: the readiness check before Start, if the client answered it. */
  readiness?: ReadinessView | null;
  /** PRD D10: form-check videos, oldest first. */
  formChecks?: FormCheckView[];
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
    select: {
      ...SUMMARY_SELECT,
      comment: true,
      submittedAt: true,
      readinessJson: true,
      readinessAt: true,
    },
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

  const swaps = await swapsForSession(tx, row.id);
  const plannedIds = workout.exercises.map((e) => e.exerciseId);
  // "Last time" and PR bests also for the alternatives done instead.
  const performedIds = [...plannedIds, ...Object.values(swaps).map((x) => x.exerciseId)];
  const previous = await getExercisePerformance(tx, row.clientId, performedIds, {
    excludeSessionId: row.id,
  });
  const bests = await exerciseBestsBefore(tx, row.clientId, performedIds, row.id);
  const alternatives = await alternativesFor(tx, plannedIds);

  return {
    session: { ...summary, comment: row.comment, workoutVersionId: row.workoutVersionId },
    workout,
    logs: logs.map((l) => ({
      workoutVersionExerciseId: l.workoutVersionExerciseId,
      setIndex: l.setIndex,
      ...toSetLogValue(l),
    })),
    previous,
    bests,
    swaps,
    alternatives,
    notes: await notesForSession(tx, row.id),
    client,
    revisions,
    editableUntil,
    readiness: readReadiness(row.readinessJson, row.readinessScore, row.readinessAt),
    formChecks: await formChecksFor(tx, row.id),
  };
}
