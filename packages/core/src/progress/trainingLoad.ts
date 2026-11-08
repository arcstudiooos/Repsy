import type { TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { fromDbDate, isoWeekOf, toDbDate } from '../sessions/read';
import { loadClientSwaps } from '../sessions/swaps';
import { todayInZone } from '../timezone';
import { resolveClientId } from './records';

/** PRD E8: one ISO week (Monday to Sunday) of completed training. */
export interface TrainingLoadWeek {
  weekStart: string;
  sessions: number;
  /** Logged sets with any value. */
  sets: number;
  /** Load × reps over every set with both, in kg. */
  volumeKg: number;
  /** Mean RPE of the sets that have one; null when none do. */
  avgRpe: number | null;
  /** Sets per muscle group (the exercise actually done, swaps included). */
  setsByMuscle: Record<string, number>;
}

export interface TrainingLoad {
  /** Oldest first, ending with the current week. */
  weeks: TrainingLoadWeek[];
  /** Muscle groups trained in the period, most sets first. */
  muscles: string[];
}

export const TRAINING_LOAD_WEEKS = 8;

const addDays = (d: string, n: number) =>
  new Date(toDbDate(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const num = (d: { toString(): string } | null) => (d === null ? null : Number(d.toString()));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Weekly sessions, sets, volume and average RPE, and sets by muscle group, for the last 8 weeks (PRD E8). */
export async function getTrainingLoad(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  opts: { now?: Date; weeks?: number } = {},
): Promise<TrainingLoad> {
  const id = await resolveClientId(tx, actor, clientId);
  const client = await tx.client.findFirstOrThrow({ where: { id }, select: { timezone: true } });
  const count = opts.weeks ?? TRAINING_LOAD_WEEKS;
  const thisWeek = isoWeekOf(todayInZone(client.timezone, opts.now ?? new Date())).start;
  const starts = Array.from({ length: count }, (_, i) => addDays(thisWeek, -7 * (count - 1 - i)));
  const from = starts[0]!;
  const until = addDays(thisWeek, 7);

  const sessions = await tx.workoutSession.findMany({
    where: {
      clientId: id,
      state: 'completed',
      scheduledLocalDate: { gte: toDbDate(from), lt: toDbDate(until) },
    },
    select: { id: true, scheduledLocalDate: true },
  });
  const weekOf = new Map(
    sessions.map((s) => [s.id, isoWeekOf(fromDbDate(s.scheduledLocalDate)).start]),
  );
  const logs = sessions.length
    ? await tx.setLog.findMany({
        where: { sessionId: { in: sessions.map((s) => s.id) } },
        select: {
          sessionId: true,
          workoutVersionExerciseId: true,
          reps: true,
          weightKg: true,
          rpe: true,
          durationSeconds: true,
          distanceM: true,
          workoutVersionExercise: {
            select: { exercise: { select: { id: true, muscleGroup: true } } },
          },
        },
      })
    : [];
  const swaps = await loadClientSwaps(tx, id);
  const swappedIds = new Set<string>();
  const performed = logs.map((l) => {
    const plannedId = l.workoutVersionExercise.exercise.id;
    const exerciseId = swaps.performed(l.sessionId, l.workoutVersionExerciseId, plannedId);
    if (exerciseId !== plannedId) swappedIds.add(exerciseId);
    return { l, exerciseId };
  });
  const muscleOf = new Map(
    logs.map((l) => [
      l.workoutVersionExercise.exercise.id,
      l.workoutVersionExercise.exercise.muscleGroup,
    ]),
  );
  for (const e of swappedIds.size
    ? await tx.exercise.findMany({
        where: { id: { in: [...swappedIds] } },
        select: { id: true, muscleGroup: true },
      })
    : []) {
    muscleOf.set(e.id, e.muscleGroup);
  }

  const weeks = new Map<string, TrainingLoadWeek & { rpeSum: number; rpeN: number }>(
    starts.map((w) => [
      w,
      {
        weekStart: w,
        sessions: 0,
        sets: 0,
        volumeKg: 0,
        avgRpe: null,
        setsByMuscle: {},
        rpeSum: 0,
        rpeN: 0,
      },
    ]),
  );
  for (const s of sessions) {
    const w = weeks.get(weekOf.get(s.id)!);
    if (w) w.sessions += 1;
  }
  const totals = new Map<string, number>();
  for (const { l, exerciseId } of performed) {
    const w = weeks.get(weekOf.get(l.sessionId)!);
    if (!w) continue;
    const weight = num(l.weightKg);
    const rpe = num(l.rpe);
    const any =
      (l.reps ?? 0) > 0 ||
      (weight ?? 0) > 0 ||
      (l.durationSeconds ?? 0) > 0 ||
      (num(l.distanceM) ?? 0) > 0;
    if (!any) continue;
    w.sets += 1;
    if (weight !== null && weight > 0 && l.reps !== null && l.reps > 0)
      w.volumeKg += weight * l.reps;
    if (rpe !== null) {
      w.rpeSum += rpe;
      w.rpeN += 1;
    }
    const muscle = muscleOf.get(exerciseId) ?? 'Other';
    w.setsByMuscle[muscle] = (w.setsByMuscle[muscle] ?? 0) + 1;
    totals.set(muscle, (totals.get(muscle) ?? 0) + 1);
  }
  return {
    weeks: [...weeks.values()].map(({ rpeSum, rpeN, ...w }) => ({
      ...w,
      volumeKg: round1(w.volumeKg),
      avgRpe: rpeN ? round1(rpeSum / rpeN) : null,
    })),
    muscles: [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([m]) => m),
  };
}
