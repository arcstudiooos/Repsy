/**
 * Started workouts kept on the device (S3-3): the server payload from Start plus every value the client typed, so a
 * closed and reopened page (online or not) shows the device's latest sets, never an older server payload.
 */
import type { LoggedSet, SessionDetail, SetLogAck } from '@kinetic/core';
import { countOutbox, del, get, getBySession, put } from './db';

export type FinishKind = 'completed' | 'skipped';

export interface CachedWorkout {
  sessionId: string;
  /** The last server payload (Start, or the finished session once its completion was acknowledged). */
  detail: SessionDetail;
  /** What the client logged on this device, newest per set. */
  local: LoggedSet[];
  /** Finished on this device (queued or acknowledged). */
  finished?: FinishKind;
  cachedAt: number;
}

export interface LocalView {
  detail: SessionDetail;
  logs: LoggedSet[];
  finished?: FinishKind;
}

const keyOf = (l: { workoutVersionExerciseId: string; setIndex: number }) =>
  `${l.workoutVersionExerciseId}:${l.setIndex}`;

/** Per set, the value with the latest `clientUpdatedAt` (ISO strings compare in time order). */
export function newest(...lists: LoggedSet[][]): LoggedSet[] {
  const out = new Map<string, LoggedSet>();
  for (const list of lists) {
    for (const l of list) {
      const prev = out.get(keyOf(l));
      if (!prev || l.clientUpdatedAt >= prev.clientUpdatedAt) out.set(keyOf(l), l);
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      a.workoutVersionExerciseId.localeCompare(b.workoutVersionExerciseId) ||
      a.setIndex - b.setIndex,
  );
}

const FINISHED: SessionDetail['session']['state'][] = ['completed', 'skipped'];

/** Stores the server payload, keeping anything already logged or finished on this device. */
export async function cacheWorkout(detail: SessionDetail): Promise<void> {
  const existing = await getCachedWorkout(detail.session.id);
  const state = detail.session.state;
  await put<CachedWorkout>('workouts', {
    sessionId: detail.session.id,
    detail,
    local: existing?.local ?? [],
    finished: FINISHED.includes(state) ? (state as FinishKind) : existing?.finished,
    cachedAt: Date.now(),
  });
}

export const getCachedWorkout = (sessionId: string) => get<CachedWorkout>('workouts', sessionId);

/**
 * Records values typed on this device. No-op for a workout that was never cached (not started here). What the client
 * just typed is this device's latest value for the set, whatever its clock says (a skewed clock must not keep an
 * older value on top, PR #2 review I2).
 */
export async function applyLocal(sessionId: string, logs: LoggedSet[]): Promise<void> {
  await replaceLocal(sessionId, logs);
}

/** Replaces the device's value of each given set (typed values, or the same values re-stamped by a clock retry). */
export async function replaceLocal(sessionId: string, logs: LoggedSet[]): Promise<void> {
  if (logs.length === 0) return;
  const cached = await getCachedWorkout(sessionId);
  if (!cached) return;
  const given = new Set(logs.map(keyOf));
  const kept = cached.local.filter((l) => !given.has(keyOf(l)));
  await put<CachedWorkout>('workouts', { ...cached, local: newest(kept, logs) });
}

/** Server acknowledgements: the stored values join the payload, and a newer server value replaces an older local one. */
export async function applyAcks(sessionId: string, acks: SetLogAck[]): Promise<void> {
  const cached = await getCachedWorkout(sessionId);
  if (!cached) return;
  const server = acks.map((a) => ({
    ...a.value,
    workoutVersionExerciseId: a.workoutVersionExerciseId,
    setIndex: a.setIndex,
  }));
  await put<CachedWorkout>('workouts', {
    ...cached,
    detail: { ...cached.detail, logs: newest(cached.detail.logs, server) },
    local: newest(cached.local, server),
  });
}

export async function markFinished(sessionId: string, kind: FinishKind): Promise<void> {
  const cached = await getCachedWorkout(sessionId);
  if (cached) await put<CachedWorkout>('workouts', { ...cached, finished: kind });
}

/** The device's finish was refused or taken back: the workout reads as it did before (PR #2 review I1). */
export async function unmarkFinished(sessionId: string): Promise<void> {
  const cached = await getCachedWorkout(sessionId);
  if (cached?.finished) {
    await put<CachedWorkout>('workouts', { ...cached, finished: undefined });
  }
}

/** The workout as this device knows it: the cached payload with the device's newest value per set. */
export async function localView(sessionId: string): Promise<LocalView | null> {
  const cached = await getCachedWorkout(sessionId);
  if (!cached) return null;
  return {
    detail: cached.detail,
    logs: newest(cached.detail.logs, cached.local),
    finished: cached.finished,
  };
}

/**
 * Drops a finished workout once nothing for it waits in the outbox and nothing of it was refused (the refused values
 * stay readable). Returns whether it was removed.
 */
export async function evict(sessionId: string): Promise<boolean> {
  const cached = await getCachedWorkout(sessionId);
  if (!cached) return false;
  const finished = cached.finished ?? FINISHED.includes(cached.detail.session.state);
  if (!finished || (await countOutbox(sessionId)) > 0) return false;
  if ((await getBySession('rejected', sessionId)).length > 0) return false;
  await del('workouts', sessionId);
  return true;
}
