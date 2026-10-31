import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { fromDbDate } from '../sessions/read';
import { isUuid } from '../uuid';

/** Rep counts with a tracked rep max (the heaviest load lifted for at least that many reps). */
export const REP_MAX_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
/** Sets above this many reps are left out of the estimated 1RM: the formula is unreliable for long sets. */
export const E1RM_MAX_REPS = 12;
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

/** Epley; a single is its own weight. Null outside 1..E1RM_MAX_REPS reps or without a load. */
export function estimateOneRepMax(weightKg: number | null, reps: number | null): number | null {
  if (weightKg === null || weightKg <= 0 || reps === null || reps < 1 || reps > E1RM_MAX_REPS) {
    return null;
  }
  return reps === 1 ? weightKg : round1(weightKg * (1 + reps / 30));
}

/**
 * The client whose progress the actor may read: a client reads only their own record; a coach reads any client in
 * their organization (the tenant scope hides other organizations, which reads as NOT_FOUND).
 */
async function resolveClientId(
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
  const logs = await tx.setLog.findMany({
    where: {
      session: { is: { clientId, state: 'completed' } },
      ...(exerciseId ? { workoutVersionExercise: { is: { exerciseId } } } : {}),
    },
    select: {
      sessionId: true,
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
  const rows = logs.map((l) => {
    const ex = l.workoutVersionExercise.exercise;
    exercises.set(ex.id, { name: ex.name, trackingType: ex.trackingType });
    return {
      sessionId: l.sessionId,
      localDate: fromDbDate(l.session.scheduledLocalDate),
      exerciseId: ex.id,
      reps: l.reps,
      weightKg: num(l.weightKg),
      durationSeconds: l.durationSeconds,
      distanceM: num(l.distanceM),
    };
  });
  return { rows, exercises };
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
