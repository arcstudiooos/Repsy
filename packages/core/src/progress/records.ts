import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { loadClientSwaps } from '../sessions/swaps';
import { fromDbDate } from '../sessions/read';
import { isUuid } from '../uuid';
import { E1RM_MAX_REPS, estimateOneRepMax, type ExerciseBest } from './pr';

export { E1RM_MAX_REPS, estimateOneRepMax, isPersonalRecord, type ExerciseBest } from './pr';

/** Rep counts with a tracked rep max (the heaviest load lifted for at least that many reps). */
export const REP_MAX_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
/** The most sessions one exercise history returns, newest first. */
export const HISTORY_LIMIT = 104;

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

/** A record and where it was set. Loads are in kg. */
export interface SetRecord {
  weightKg: number;
  reps: number;
  localDate: string;
  sessionId: string;
}

export interface ExerciseRecords {
  exerciseId: string;
  name: string;
  trackingType: 'reps_load' | 'duration' | 'distance';
  /** Estimated 1RM by the Epley formula (weight × (1 + reps / 30); a single is its own weight). Labelled "estimated". */
  estimatedOneRepMax: (SetRecord & { valueKg: number }) | null;
  /** The heaviest load lifted for at least one rep. */
  heaviest: SetRecord | null;
  /** Index i is the heaviest load lifted for at least i + 1 reps (null when never reached). */
  repMaxes: (SetRecord | null)[];
  /** The completed session with the most volume (sum of weight × reps) for this exercise. */
  bestVolume: { volumeKg: number; localDate: string; sessionId: string } | null;
  /** The most reps in one set, with or without a load (bodyweight exercises have only this). */
  mostReps: { reps: number; localDate: string; sessionId: string } | null;
  longestDuration: { seconds: number; localDate: string; sessionId: string } | null;
  longestDistance: { meters: number; localDate: string; sessionId: string } | null;
  sessions: number;
  lastLocalDate: string;
}

/** One completed session's work on an exercise (E7). */
export interface ExerciseHistoryEntry {
  sessionId: string;
  localDate: string;
  sets: number;
  /** The set with the heaviest load (ties: more reps). */
  topSet: { weightKg: number; reps: number } | null;
  estimatedOneRepMaxKg: number | null;
  volumeKg: number;
  totalReps: number;
  longestSeconds: number | null;
  longestMeters: number | null;
}

interface LogRow {
  sessionId: string;
  localDate: string;
  exerciseId: string;
  reps: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
}

type Decimalish = { toString(): string } | null;
const num = (d: Decimalish): number | null => (d === null ? null : Number(d.toString()));
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The client whose progress the actor may read: a client reads only their own record; a coach reads any client in
 * their organization (the tenant scope hides other organizations, which reads as NOT_FOUND).
 */
export async function resolveClientId(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
): Promise<string> {
  assertCan(actor, 'session:read');
  if (!isUuid(clientId)) throw notFound();
  if (actor.role === 'client' && actor.clientId?.toLowerCase() !== clientId.toLowerCase()) {
    throw notFound();
  }
  const client = await tx.client.findFirst({ where: { id: clientId }, select: { id: true } });
  if (!client) throw notFound();
  return client.id;
}

/**
 * Every logged set of the client's completed sessions. Log corrections update the set rows themselves (revisions keep
 * the history), so records always reflect the corrected values. Skipped, missed and unfinished sessions never count.
 */
async function loadLogs(
  tx: TenantTx,
  clientId: string,
  exerciseId?: string,
): Promise<{
  rows: LogRow[];
  exercises: Map<string, Pick<ExerciseRecords, 'name' | 'trackingType'>>;
}> {
  // Sets count for the exercise actually done: a swap (PRD D8) credits the alternative.
  const swaps = await loadClientSwaps(tx, clientId);
  const logs = await tx.setLog.findMany({
    where: {
      session: { is: { clientId, state: 'completed' } },
      ...(exerciseId ? swaps.where([exerciseId]) : {}),
    },
    select: {
      sessionId: true,
      workoutVersionExerciseId: true,
      reps: true,
      weightKg: true,
      durationSeconds: true,
      distanceM: true,
      session: { select: { scheduledLocalDate: true } },
      workoutVersionExercise: {
        select: { exercise: { select: { id: true, name: true, trackingType: true } } },
      },
    },
  });
  const exercises = new Map<string, Pick<ExerciseRecords, 'name' | 'trackingType'>>();
  const performedIds = new Set<string>();
  const rows = logs.map((l) => {
    const planned = l.workoutVersionExercise.exercise;
    exercises.set(planned.id, { name: planned.name, trackingType: planned.trackingType });
    const id = swaps.performed(l.sessionId, l.workoutVersionExerciseId, planned.id);
    performedIds.add(id);
    return {
      sessionId: l.sessionId,
      localDate: fromDbDate(l.session.scheduledLocalDate),
      exerciseId: id,
      reps: l.reps,
      weightKg: num(l.weightKg),
      durationSeconds: l.durationSeconds,
      distanceM: num(l.distanceM),
    };
  });
  const missing = [...performedIds].filter((id) => !exercises.has(id));
  if (missing.length) {
    for (const e of await tx.exercise.findMany({
      where: { id: { in: missing } },
      select: { id: true, name: true, trackingType: true },
    })) {
      exercises.set(e.id, { name: e.name, trackingType: e.trackingType });
    }
  }
  // Planned exercises whose every set was swapped away have no rows; drop their names too.
  for (const id of [...exercises.keys()]) if (!performedIds.has(id)) exercises.delete(id);
  // A history for one exercise keeps only the sets performed as it.
  const kept = exerciseId ? rows.filter((r) => r.exerciseId === exerciseId) : rows;
  return { rows: kept, exercises };
}

/** Earlier date wins a tie, so a record is credited to the session that first set it. */
const better = (value: number, date: string, best: { v: number; d: string } | null) =>
  best === null || value > best.v || (value === best.v && date < best.d);

/** Personal records per exercise the client has logged in a completed session (PRD E6), sorted by exercise name. */
export async function getPersonalRecords(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
): Promise<ExerciseRecords[]> {
  const id = await resolveClientId(tx, actor, clientId);
  const { rows, exercises } = await loadLogs(tx, id);

  const byExercise = new Map<string, LogRow[]>();
  for (const r of rows) {
    const list = byExercise.get(r.exerciseId);
    if (list) list.push(r);
    else byExercise.set(r.exerciseId, [r]);
  }

  const result: ExerciseRecords[] = [];
  for (const [exerciseId, logs] of byExercise) {
    const meta = exercises.get(exerciseId)!;
    let e1rm: { v: number; d: string; row: LogRow } | null = null;
    let heaviest: { v: number; d: string; row: LogRow } | null = null;
    const repMax: ({ v: number; d: string; row: LogRow } | null)[] = REP_MAX_COUNTS.map(() => null);
    let duration: { v: number; d: string; row: LogRow } | null = null;
    let reps: { v: number; d: string; row: LogRow } | null = null;
    let distance: { v: number; d: string; row: LogRow } | null = null;
    const volume = new Map<string, { v: number; d: string }>();
    const sessions = new Set<string>();
    let last = '';

    for (const r of logs) {
      sessions.add(r.sessionId);
      if (r.localDate > last) last = r.localDate;
      const est = estimateOneRepMax(r.weightKg, r.reps);
      if (est !== null && better(est, r.localDate, e1rm)) e1rm = { v: est, d: r.localDate, row: r };
      if (r.weightKg !== null && r.weightKg > 0 && r.reps !== null && r.reps >= 1) {
        if (better(r.weightKg, r.localDate, heaviest)) {
          heaviest = { v: r.weightKg, d: r.localDate, row: r };
        }
        for (const count of REP_MAX_COUNTS) {
          if (r.reps < count) break;
          const i = count - 1;
          if (better(r.weightKg, r.localDate, repMax[i] ?? null)) {
            repMax[i] = { v: r.weightKg, d: r.localDate, row: r };
          }
        }
        const s = volume.get(r.sessionId) ?? { v: 0, d: r.localDate };
        s.v += r.weightKg * r.reps;
        volume.set(r.sessionId, s);
      }
      if (r.reps !== null && r.reps > 0 && better(r.reps, r.localDate, reps)) {
        reps = { v: r.reps, d: r.localDate, row: r };
      }
      if (r.durationSeconds !== null && r.durationSeconds > 0) {
        if (better(r.durationSeconds, r.localDate, duration)) {
          duration = { v: r.durationSeconds, d: r.localDate, row: r };
        }
      }
      if (r.distanceM !== null && r.distanceM > 0) {
        if (better(r.distanceM, r.localDate, distance)) {
          distance = { v: r.distanceM, d: r.localDate, row: r };
        }
      }
    }

    let bestVolume: ExerciseRecords['bestVolume'] = null;
    for (const [sessionId, s] of volume) {
      if (
        bestVolume === null ||
        better(s.v, s.d, { v: bestVolume.volumeKg, d: bestVolume.localDate })
      ) {
        bestVolume = { volumeKg: round1(s.v), localDate: s.d, sessionId };
      }
    }
    const setRecord = (x: { row: LogRow } | null): SetRecord | null =>
      x && x.row.weightKg !== null && x.row.reps !== null
        ? {
            weightKg: x.row.weightKg,
            reps: x.row.reps,
            localDate: x.row.localDate,
            sessionId: x.row.sessionId,
          }
        : null;

    result.push({
      exerciseId,
      name: meta.name,
      trackingType: meta.trackingType,
      estimatedOneRepMax: e1rm ? { ...setRecord(e1rm)!, valueKg: e1rm.v } : null,
      heaviest: setRecord(heaviest),
      repMaxes: repMax.map(setRecord),
      bestVolume,
      mostReps: reps ? { reps: reps.v, localDate: reps.d, sessionId: reps.row.sessionId } : null,
      longestDuration: duration
        ? { seconds: duration.v, localDate: duration.d, sessionId: duration.row.sessionId }
        : null,
      longestDistance: distance
        ? { meters: distance.v, localDate: distance.d, sessionId: distance.row.sessionId }
        : null,
      sessions: sessions.size,
      lastLocalDate: last,
    });
  }
  return result.sort(
    (a, b) => a.name.localeCompare(b.name) || a.exerciseId.localeCompare(b.exerciseId),
  );
}

/** One exercise's completed sessions for the client, newest first (PRD E7), at most HISTORY_LIMIT. */
export async function getExerciseHistory(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
  exerciseId: string,
): Promise<{
  exercise: Pick<ExerciseRecords, 'exerciseId' | 'name' | 'trackingType'>;
  entries: ExerciseHistoryEntry[];
}> {
  const id = await resolveClientId(tx, actor, clientId);
  if (!isUuid(exerciseId)) throw notFound();
  const { rows, exercises } = await loadLogs(tx, id, exerciseId);
  const meta = exercises.get(rows[0]?.exerciseId ?? '');
  if (!meta || !rows[0]) throw notFound();

  const bySession = new Map<string, ExerciseHistoryEntry>();
  for (const r of rows) {
    let e = bySession.get(r.sessionId);
    if (!e) {
      e = {
        sessionId: r.sessionId,
        localDate: r.localDate,
        sets: 0,
        topSet: null,
        estimatedOneRepMaxKg: null,
        volumeKg: 0,
        totalReps: 0,
        longestSeconds: null,
        longestMeters: null,
      };
      bySession.set(r.sessionId, e);
    }
    e.sets += 1;
    e.totalReps += r.reps ?? 0;
    if (r.weightKg !== null && r.weightKg > 0 && r.reps !== null && r.reps >= 1) {
      e.volumeKg = round1(e.volumeKg + r.weightKg * r.reps);
      const t = e.topSet;
      if (!t || r.weightKg > t.weightKg || (r.weightKg === t.weightKg && r.reps > t.reps)) {
        e.topSet = { weightKg: r.weightKg, reps: r.reps };
      }
    }
    const est = estimateOneRepMax(r.weightKg, r.reps);
    if (est !== null && (e.estimatedOneRepMaxKg === null || est > e.estimatedOneRepMaxKg)) {
      e.estimatedOneRepMaxKg = est;
    }
    if (
      r.durationSeconds !== null &&
      (e.longestSeconds === null || r.durationSeconds > e.longestSeconds)
    ) {
      e.longestSeconds = r.durationSeconds;
    }
    if (r.distanceM !== null && (e.longestMeters === null || r.distanceM > e.longestMeters)) {
      e.longestMeters = r.distanceM;
    }
  }
  const entries = [...bySession.values()]
    .sort(
      (a, b) => b.localDate.localeCompare(a.localDate) || b.sessionId.localeCompare(a.sessionId),
    )
    .slice(0, HISTORY_LIMIT);
  return { exercise: { exerciseId: rows[0].exerciseId, ...meta }, entries };
}

/** Bests per exercise id from the client's other completed sessions (never `excludeSessionId`). */
export async function exerciseBestsBefore(
  tx: TenantTx,
  clientId: string,
  exerciseIds: string[],
  excludeSessionId: string,
): Promise<Record<string, ExerciseBest>> {
  const ids = [...new Set(exerciseIds)];
  if (ids.length === 0) return {};
  const swaps = await loadClientSwaps(tx, clientId);
  const performedWhere = swaps.where(ids);
  const sets = await tx.setLog.findMany({
    where: {
      sessionId: { not: excludeSessionId },
      session: { is: { clientId, state: 'completed' } },
      ...performedWhere,
    },
    select: {
      sessionId: true,
      workoutVersionExerciseId: true,
      weightKg: true,
      reps: true,
      durationSeconds: true,
      distanceM: true,
      workoutVersionExercise: { select: { exerciseId: true } },
    },
  });
  const wanted = new Set(ids);
  const out: Record<string, ExerciseBest> = {};
  const max = (a: number | null, b: number | null) =>
    a === null ? b : b === null ? a : Math.max(a, b);
  for (const s of sets) {
    // Credited to the exercise actually done (a swap credits the alternative, PRD D8).
    const ex = swaps.performed(
      s.sessionId,
      s.workoutVersionExerciseId,
      s.workoutVersionExercise.exerciseId,
    );
    if (!wanted.has(ex)) continue;
    const prev = out[ex] ?? {
      heaviestKg: null,
      estimatedOneRepMaxKg: null,
      mostReps: null,
      longestSeconds: null,
      longestMeters: null,
    };
    const weight = num(s.weightKg);
    const est =
      weight !== null && weight > 0 && s.reps !== null && s.reps >= 1 && s.reps <= E1RM_MAX_REPS
        ? estimateOneRepMax(weight, s.reps)
        : null;
    out[ex] = {
      heaviestKg: max(prev.heaviestKg, weight),
      estimatedOneRepMaxKg: max(prev.estimatedOneRepMaxKg, est),
      mostReps: max(prev.mostReps, s.reps),
      longestSeconds: max(prev.longestSeconds, s.durationSeconds),
      longestMeters: max(prev.longestMeters, num(s.distanceM)),
    };
  }
  return out;
}
