import { createHash } from 'node:crypto';
import { z } from 'zod';
import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { reconcileSessions } from '../assignments/reconcile';
import { isUuid } from '../uuid';
import { assertEditableProgram } from './drafts';
import { targetSchema, type SetTarget } from './targets';

export const MAX_WEEKS = 16;
export const MAX_DAYS_PER_WEEK = 7;
export const MAX_EXERCISES_PER_DAY = 30;
export const TITLE_MAX = 120;
const NOTES_MAX = 2000;
const NOTE_MAX = 500;

export type ExerciseInput = { exerciseId: string; note?: string; sets: SetTarget[] };
export type DayInput = { title: string; notes?: string; exercises: ExerciseInput[] };
export type WeekInput = { days: DayInput[] };

const exerciseSchema = z.strictObject({
  exerciseId: z.uuid(),
  note: z.string().trim().max(NOTE_MAX).optional(),
  sets: targetSchema,
});
const daySchema = z.strictObject({
  title: z.string().trim().min(1).max(TITLE_MAX),
  notes: z.string().trim().max(NOTES_MAX).optional(),
  exercises: z.array(exerciseSchema).min(1).max(MAX_EXERCISES_PER_DAY),
});
const weeksSchema = z
  .array(z.strictObject({ days: z.array(daySchema).min(1).max(MAX_DAYS_PER_WEEK) }))
  .min(1)
  .max(MAX_WEEKS);

const weeksInvalid = (...messages: string[]) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { weeks: messages });

/** Parses and normalizes the builder payload; every failure surfaces as fieldError `weeks`. */
export function parseWeeks(input: unknown): z.infer<typeof weeksSchema> {
  const parsed = weeksSchema.safeParse(input);
  if (!parsed.success) {
    const messages = parsed.error.issues
      .slice(0, 5)
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
    throw weeksInvalid(...messages);
  }
  const counts = new Set(parsed.data.map((w) => w.days.length));
  if (counts.size !== 1) {
    throw weeksInvalid('Every week must have the same number of training days.');
  }
  return parsed.data;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** JSON with object keys sorted at every level, so equal content always serializes identically. */
function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k] as Json)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

interface Normalized {
  title: string;
  notes: string;
  exercises: { exerciseId: string; note: string | null; sets: SetTarget[] }[];
}

function normalize(day: z.infer<typeof daySchema>): Normalized {
  return {
    title: day.title,
    notes: day.notes ?? '',
    exercises: day.exercises.map((e) => ({
      exerciseId: e.exerciseId.toLowerCase(),
      note: e.note ? e.note : null,
      sets: e.sets,
    })),
  };
}

/** sha256 hex of the canonical JSON of `{title, notes, exercises}`. */
export const contentHash = (w: Normalized): string =>
  createHash('sha256')
    .update(canonical(w as unknown as Json))
    .digest('hex');

const REQUIRED_FIELD = {
  reps_load: 'reps',
  duration: 'durationSec',
  distance: 'distanceM',
} as const;

export interface CommitInput {
  programId: string;
  expectedVersionNo: number | null;
  weeks: WeekInput[];
}

/**
 * Commits a new immutable ProgramVersion (D-001/D-002). Slots whose workout content is unchanged keep pointing
 * at the existing WorkoutVersion; only changed content creates rows. The program row is locked first, so two
 * commits with the same `expectedVersionNo` cannot both pass the version check.
 *
 * A client copy is editable only while its assignment is active (Ruling 1) and keeps one training day per scheduled
 * weekday (Ruling 2); its sessions are then reconciled with the new slots in the same transaction (S3-2).
 * Templates never touch sessions.
 */
export async function commitProgramVersion(
  tx: TenantTx,
  actor: ActorContext,
  input: CommitInput,
  opts: { requestId?: string; now?: Date } = {},
): Promise<{ versionNo: number; versionId: string }> {
  assertCan(actor, 'program:write');
  const { programId, expectedVersionNo } = input;
  if (!isUuid(programId)) throw new DomainError('NOT_FOUND', 'Not found.');
  const weeks = parseWeeks(input.weeks);

  // No raw SQL in TenantTx: a no-op UPDATE takes the same row lock as SELECT ... FOR UPDATE and holds it
  // until the surrounding transaction ends. Zero rows means the program is absent or belongs to another org.
  const touched = await tx.program.updateMany({
    where: { id: programId },
    data: { updatedAt: new Date() },
  });
  if (touched.count === 0) throw new DomainError('NOT_FOUND', 'Not found.');
  const { kind } = await assertEditableProgram(tx, programId);

  let assignment: { id: string; weekdays: number[] } | null = null;
  if (kind === 'client') {
    // Lock the active assignment too (no-op UPDATE): a concurrent replace (assignProgram ends it and cancels its
    // sessions) then waits for this commit instead of interleaving with the reconcile below.
    const held = await tx.programAssignment.updateMany({
      where: { programId, status: 'active' },
      data: { status: 'active' },
    });
    assignment = held.count
      ? await tx.programAssignment.findFirst({
          where: { programId, status: 'active' },
          select: { id: true, weekdays: true },
        })
      : null;
    if (!assignment) {
      throw new DomainError('CONFLICT', 'This program is no longer active for this client.');
    }
  }

  const program = await tx.program.findFirst({
    where: { id: programId },
    select: { currentVersion: { select: { id: true, versionNo: true } } },
  });
  const current = program?.currentVersion ?? null;
  const currentVersionNo = current?.versionNo ?? null;
  if (expectedVersionNo !== currentVersionNo) {
    throw new DomainError('CONFLICT', 'This program changed since you opened it.', undefined, {
      currentVersionNo,
    });
  }
  // After the version check, so a stale tab gets 409 rather than a 422 about content it can't see.
  if (assignment && weeks[0]!.days.length !== assignment.weekdays.length) {
    const n = assignment.weekdays.length;
    throw weeksInvalid(
      `A client program keeps ${n} training days per week, one per scheduled weekday.`,
    );
  }

  // Exercises must be global or this org's own: the tenant read scope hides every other org's.
  const exerciseIds = [
    ...new Set(
      weeks.flatMap((w) =>
        w.days.flatMap((d) => d.exercises.map((e) => e.exerciseId.toLowerCase())),
      ),
    ),
  ];
  const found = await tx.exercise.findMany({
    where: { id: { in: exerciseIds } },
    select: { id: true, trackingType: true },
  });
  const tracking = new Map(found.map((e) => [e.id, e.trackingType]));
  if (tracking.size !== exerciseIds.length) {
    throw new DomainError('NOT_FOUND', 'Exercise not found.');
  }

  const problems: string[] = [];
  weeks.forEach((week, w) =>
    week.days.forEach((day, d) =>
      day.exercises.forEach((ex, e) => {
        const need = REQUIRED_FIELD[tracking.get(ex.exerciseId.toLowerCase())!];
        ex.sets.forEach((set, s) => {
          if (set[need] === undefined) {
            problems.push(`${w}.days.${d}.exercises.${e}.sets.${s}: ${need} is required.`);
          }
        });
      }),
    ),
  );
  if (problems.length) throw weeksInvalid(...problems.slice(0, 5));

  const previous = new Map<string, { id: string; hash: string }>();
  if (current) {
    const slots = await tx.programSlot.findMany({
      where: { programVersionId: current.id },
      select: {
        weekIndex: true,
        dayIndex: true,
        workoutVersion: { select: { id: true, contentHash: true } },
      },
    });
    for (const s of slots) {
      previous.set(`${s.weekIndex}:${s.dayIndex}`, {
        id: s.workoutVersion.id,
        hash: s.workoutVersion.contentHash,
      });
    }
  }

  const resolved = new Map<string, string>(); // hash -> workoutVersionId (existing or created in this commit)
  const slotRows: { weekIndex: number; dayIndex: number; workoutVersionId: string }[] = [];
  let created = 0;

  for (const [weekIndex, week] of weeks.entries()) {
    for (const [dayIndex, day] of week.days.entries()) {
      const workout = normalize(day);
      const hash = contentHash(workout);
      let id: string | undefined;

      const prev = previous.get(`${weekIndex}:${dayIndex}`);
      if (prev && prev.hash === hash) id = prev.id;
      id ??= resolved.get(hash);
      id ??= (
        await tx.workoutVersion.findFirst({
          where: { contentHash: hash, slots: { some: { programVersion: { programId } } } },
          select: { id: true },
        })
      )?.id;

      if (!id) {
        // Scalar FKs only: the tenant extension injects scalar organizationId.
        const row = await tx.workoutVersion.create({
          data: { title: workout.title, notes: workout.notes, contentHash: hash },
        } as Parameters<typeof tx.workoutVersion.create>[0]);
        await tx.workoutVersionExercise.createMany({
          data: workout.exercises.map((e, position) => ({
            workoutVersionId: row.id,
            exerciseId: e.exerciseId,
            position,
            targetJson: e.sets,
            note: e.note,
          })),
        } as unknown as Parameters<typeof tx.workoutVersionExercise.createMany>[0]);
        id = row.id;
        created += 1;
      }
      resolved.set(hash, id);
      slotRows.push({ weekIndex, dayIndex, workoutVersionId: id });
    }
  }

  const versionNo = (currentVersionNo ?? 0) + 1;
  const version = await tx.programVersion.create({
    data: {
      programId,
      versionNo,
      committedBy: actor.userId,
      daysPerWeek: weeks[0]!.days.length,
      weekCount: weeks.length,
    },
  } as Parameters<typeof tx.programVersion.create>[0]);
  await tx.programSlot.createMany({
    data: slotRows.map((s) => ({ ...s, programVersionId: version.id })),
  } as Parameters<typeof tx.programSlot.createMany>[0]);
  await tx.program.updateMany({ where: { id: programId }, data: { currentVersionId: version.id } });
  // The committed content supersedes the autosaved draft; a 409 above throws first, so the draft survives it.
  await tx.programDraft.deleteMany({ where: { programId } });

  let reconciled = {};
  if (assignment && current) {
    const toKeys = new Set(slotRows.map((r) => `${r.weekIndex}:${r.dayIndex}`));
    const fromKeys = [...previous.keys()];
    const { cancelled, created: sessionsCreated } = await reconcileSessions(
      tx,
      assignment.id,
      current.id,
      version.id,
      { now: opts.now },
    );
    reconciled = {
      slotsAdded: [...toKeys].filter((k) => !previous.has(k)).length,
      slotsRemoved: fromKeys.filter((k) => !toKeys.has(k)).length,
      sessionsCancelled: cancelled,
      sessionsCreated,
    };
  }

  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'program',
    objectId: programId,
    action: 'program.version_committed',
    metadata: { versionNo, created, reused: slotRows.length - created, ...reconciled },
    requestId: opts.requestId,
  });
  return { versionNo, versionId: version.id };
}
