import { readBlock } from '../programs/blocks';
import { demoUrlOf } from '../exercises/media';
import { asSection } from '../programs/sections';
import type { TenantTx } from '@repsy/db';
import { DomainError } from '../errors';
import { readStoredTargets } from '../programs/read';
import { isUuid } from '../uuid';
import type { WorkoutVersionView } from './types';

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

/**
 * The WorkoutVersion an unstarted session would get today: its slot in the assignment program's **current** version
 * (D-002 #5). Throws NOT_FOUND when the slot no longer exists (S3-2 cancels such sessions).
 */
export async function resolveSlotWorkoutVersionId(
  tx: TenantTx,
  session: {
    assignmentId: string | null;
    slotWeekIndex: number | null;
    slotDayIndex: number | null;
  },
): Promise<string> {
  // An extra workout (PRD D13) has no slot; its version is fixed when it starts.
  if (!session.assignmentId || session.slotWeekIndex === null || session.slotDayIndex === null) {
    throw notFound();
  }
  const assignment = await tx.programAssignment.findFirst({
    where: { id: session.assignmentId },
    select: { program: { select: { currentVersionId: true } } },
  });
  const versionId = assignment?.program.currentVersionId;
  if (!versionId) throw notFound();
  const slot = await tx.programSlot.findFirst({
    where: {
      programVersionId: versionId,
      weekIndex: session.slotWeekIndex,
      dayIndex: session.slotDayIndex,
    },
    select: { workoutVersionId: true },
  });
  if (!slot) throw notFound();
  return slot.workoutVersionId;
}

/** One immutable workout version with its exercises in position order. */
export async function loadWorkoutVersionView(
  tx: TenantTx,
  workoutVersionId: string,
  locked: boolean,
): Promise<WorkoutVersionView> {
  const wv = await tx.workoutVersion.findFirst({
    where: { id: workoutVersionId },
    include: {
      exercises: {
        orderBy: { position: 'asc' },
        include: {
          exercise: {
            select: {
              name: true,
              trackingType: true,
              instructions: true,
              cues: true,
              mediaUrl: true,
              demoMediaId: true,
            },
          },
        },
      },
    },
  });
  if (!wv) throw notFound();
  return {
    workoutVersionId: wv.id,
    title: wv.title,
    notes: wv.notes,
    locked,
    exercises: wv.exercises.map((e) => ({
      id: e.id,
      exerciseId: e.exerciseId,
      name: e.exercise.name,
      trackingType: e.exercise.trackingType,
      instructions: e.exercise.instructions,
      cues: e.exercise.cues,
      mediaUrl: demoUrlOf(e.exercise),
      note: e.note,
      section: asSection(e.section),
      groupWithPrevious: e.groupWithPrevious,
      block: readBlock(e.blockJson),
      position: e.position,
      sets: readStoredTargets(e.targetJson),
    })),
  };
}

/**
 * The workout a session shows (S2-1): its locked version once started, completed or skipped (D-002 #6), otherwise
 * the slot of the assignment's current program version, so committed edits reach unstarted sessions without
 * rewriting them (D-002 #5). No actor: callers authorize the session first; the tenant tx still bounds it (RLS).
 */
export async function resolveSessionWorkout(
  tx: TenantTx,
  sessionId: string,
): Promise<WorkoutVersionView> {
  if (!isUuid(sessionId)) throw notFound();
  const session = await tx.workoutSession.findFirst({
    where: { id: sessionId },
    select: {
      assignmentId: true,
      slotWeekIndex: true,
      slotDayIndex: true,
      workoutVersionId: true,
    },
  });
  if (!session) throw notFound();
  if (session.workoutVersionId) return loadWorkoutVersionView(tx, session.workoutVersionId, true);
  return loadWorkoutVersionView(tx, await resolveSlotWorkoutVersionId(tx, session), false);
}
