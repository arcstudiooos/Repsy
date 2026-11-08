/**
 * The portal's write queue (S3-3, D-004): every set log, completion and skip is stored on the device first, then
 * replayed against the existing idempotent endpoints (set logs upsert on `clientUpdatedAt`, complete/skip carry an
 * idempotency key), so a replay never double-applies. Per session the queue is FIFO by a stored sequence (never the
 * wall clock): logs always reach the server before that session's completion, and a blocked item holds back every
 * later item of its session. "Synced" means the server acknowledged every queued write for the session and refused
 * none of them (D-004 #6).
 *
 * Each write carries the user and org that made it. Only the bound owner's writes for the active org are sent
 * (PR #2 review C1): another user's never are, and the portal layout wipes them on binding anyway.
 *
 * Refusals (PR #2 review I1): a refused write is kept in `rejected` with its values and the server's message, and the
 * session reads "Not saved" until it is fixed (the set saved again), dismissed, or the session finishes. A refused
 * merged batch is resent write by write, so one bad set never takes the good ones down with it. A completion or skip
 * waits ("held") while any of the session's logs were refused, until the client keeps editing or finishes anyway.
 */
import type { LoggedSet, SessionDetail, SetLogAck } from '@repsy/core';
import type { SetLogPayload } from '@/lib/workout-api';
import { currentOwner, del, getAll, getBySession, openDb, put, putInQueue } from './db';
import {
  applyAcks,
  cacheWorkout,
  markFinished,
  replaceLocal,
  unmarkFinished,
  unmarkStarted,
} from './workoutCache';

/** `start` (PRD D4): a workout started offline; it is always queued ahead of that session's sets. */
export type MutationKind = 'start' | 'logs' | 'complete' | 'skip';

export interface Mutation {
  /** `clientMutationId` for logs, the idempotency key for complete/skip. */
  id: string;
  sessionId: string;
  kind: MutationKind;
  /**
   * `{ items: SetLogPayload[] }` for logs; `{ idempotencyKey, comment? }` for complete/skip; `{ expectedWorkoutVersionId,
   * startedAt }` for start.
   */
  body: unknown;
  /** Queue position, from a stored counter (`putInQueue`). */
  seq: number;
  /** Who made the write, and in which org: it is only ever sent for them. */
  userId: string;
  orgId: string;
  attempts: number;
  /** Not retried before this time (ms) after a network or server error. */
  nextAttemptAt?: number;
  /** Set when the server refused the device clock; the session's queue waits for `retryBlocked`. */
  blockedReason?: string;
  /** Complete/skip only: "Finish anyway", sent although some of the session's logs were refused. */
  force?: boolean;
}

export interface RejectedMutation {
  id: string;
  sessionId: string;
  kind: MutationKind;
  /** What was sent: the values are kept, never silently dropped. */
  body: unknown;
  message: string;
  rejectedAt: number;
  userId?: string;
  orgId?: string;
}

export type SyncStatus = 'saved_on_device' | 'syncing' | 'synced' | 'not_saved';

export interface SyncState {
  status: SyncStatus;
  blockedReason?: string;
  /** Set while the session's completion (or skip) waits because some of its logs were refused. */
  held?: string;
  rejected: { kind: MutationKind; message: string }[];
  /** `${workoutVersionExerciseId}:${setIndex}` of sets still waiting for the server. */
  pendingRows: string[];
  /** The same keys for sets the server refused, with its message. */
  rejectedRows: Record<string, string>;
}

export interface FlushResult {
  sent: number;
  pending: number;
  blocked: number;
  rejected: number;
}

export const HELD_REASON =
  "Your workout wasn't finished because some sets couldn't be saved. Fix them, or finish anyway.";

const MAX_BATCH = 100;
const MAX_BACKOFF_MS = 60_000;
const LOOP_MS = 15_000;
const LOCK = 'repsy-outbox';
const NOTHING: FlushResult = { sent: 0, pending: 0, blocked: 0, rejected: 0 };

const backoffMs = (attempts: number) => Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts);
const itemsOf = (m: { kind: MutationKind; body: unknown }): SetLogPayload[] =>
  m.kind === 'logs' ? ((m.body as { items?: SetLogPayload[] }).items ?? []) : [];
const rowOf = (i: { workoutVersionExerciseId: string; setIndex: number }) =>
  `${i.workoutVersionExerciseId}:${i.setIndex}`;
/** The device copy of a queued set (what `applyLocal` stores). */
const loggedOf = (i: SetLogPayload): LoggedSet => ({
  workoutVersionExerciseId: i.workoutVersionExerciseId,
  setIndex: i.setIndex,
  reps: i.reps,
  weightKg: i.weightKg,
  rpe: i.rpe,
  durationSeconds: i.durationSeconds,
  distanceM: i.distanceM,
  clientUpdatedAt: i.clientUpdatedAt,
});
const isFinish = (m: { kind: MutationKind }) => m.kind === 'complete' || m.kind === 'skip';
const bySeq = (a: Mutation, b: Mutation) => a.seq - b.seq;

/** The bound owner's own writes for the active org: the only ones this tab may show or send. */
const mine = <T extends { userId?: string; orgId?: string }>(list: T[]): T[] => {
  const me = currentOwner();
  return me ? list.filter((m) => m.userId === me.userId && m.orgId === me.orgId) : [];
};
const sessionQueue = async (sessionId: string) =>
  mine(await getBySession<Mutation>('outbox', sessionId)).sort(bySeq);
const sessionRejected = async (sessionId: string) =>
  mine(await getBySession<RejectedMutation>('rejected', sessionId));

// --- listeners -------------------------------------------------------------------------------------------------

const listeners = new Map<string, Set<(s: SyncState) => void>>();
const syncing = new Set<string>();

export async function syncState(sessionId: string): Promise<SyncState> {
  const items = await sessionQueue(sessionId);
  const rejected = (await sessionRejected(sessionId)).sort((a, b) => a.rejectedAt - b.rejectedAt);
  const refusedLogs = rejected.some((r) => r.kind === 'logs');
  const rejectedRows: Record<string, string> = {};
  for (const r of rejected) for (const i of itemsOf(r)) rejectedRows[rowOf(i)] = r.message;
  return {
    status: syncing.has(sessionId)
      ? 'syncing'
      : rejected.length > 0
        ? 'not_saved'
        : items.length > 0
          ? 'saved_on_device'
          : 'synced',
    blockedReason: items.find((m) => m.blockedReason)?.blockedReason,
    held: refusedLogs && items.some((m) => isFinish(m) && !m.force) ? HELD_REASON : undefined,
    rejected: rejected.map((r) => ({ kind: r.kind, message: r.message })),
    pendingRows: [...new Set(items.flatMap((m) => itemsOf(m).map(rowOf)))],
    rejectedRows,
  };
}

async function notify(sessionId: string): Promise<void> {
  const set = listeners.get(sessionId);
  if (!set?.size) return;
  const state = await syncState(sessionId);
  for (const fn of set) fn(state);
}

/** Calls `listener` now and on every change of the session's queue. Returns the unsubscribe function. */
export function subscribe(sessionId: string, listener: (s: SyncState) => void): () => void {
  const set = listeners.get(sessionId) ?? new Set();
  set.add(listener);
  listeners.set(sessionId, set);
  void syncState(sessionId).then((s) => {
    if (set.has(listener)) listener(s);
  });
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(sessionId);
  };
}

// --- queue -----------------------------------------------------------------------------------------------------

/**
 * Stores a write for the signed-in user (re-enqueueing the same id replaces it, keeping its place) and starts a
 * flush. Waits until the store is bound; dropped if the user signed out meanwhile.
 */
export async function enqueue(
  m: Pick<Mutation, 'id' | 'sessionId' | 'kind' | 'body'>,
): Promise<void> {
  await openDb();
  const me = currentOwner();
  if (!me) return;
  await putInQueue({ ...m, userId: me.userId, orgId: me.orgId, attempts: 0 });
  if (isFinish(m)) {
    // A new finish supersedes an earlier refused one.
    for (const r of await sessionRejected(m.sessionId)) {
      if (isFinish(r)) await del('rejected', r.id);
    }
  }
  await notify(m.sessionId);
  void flush();
}

/**
 * After the user fixed the device clock: clears the session's clock block and sends it again. Every queued set is
 * re-stamped with the corrected clock, in queue order and ending now, so the server accepts them and the latest edit
 * of each set still wins (the queue is the order the client typed them in). The device copy follows.
 */
export async function retryBlocked(sessionId: string): Promise<void> {
  const queue = await sessionQueue(sessionId);
  const total = queue.reduce((n, m) => n + itemsOf(m).length, 0);
  const now = Date.now();
  let i = 0;
  const latest = new Map<string, LoggedSet>();
  for (const m of queue) {
    const items = itemsOf(m).map((item) => {
      const restamped = {
        ...item,
        clientUpdatedAt: new Date(now - (total - 1 - i++)).toISOString(),
      };
      latest.set(rowOf(item), loggedOf(restamped));
      return restamped;
    });
    await put<Mutation>('outbox', {
      ...m,
      ...(m.kind === 'logs' ? { body: { ...(m.body as object), items } } : {}),
      attempts: 0,
      blockedReason: undefined,
      nextAttemptAt: undefined,
    });
  }
  await replaceLocal(sessionId, [...latest.values()]);
  await notify(sessionId);
  await flush();
}

/** "Finish anyway": sends the session's held completion (or skip) although some of its sets were refused. */
export async function releaseHeld(sessionId: string): Promise<void> {
  for (const m of await sessionQueue(sessionId)) {
    if (isFinish(m)) await put<Mutation>('outbox', { ...m, force: true });
  }
  await notify(sessionId);
  await flush();
}

/** "Keep editing": drops the session's queued completion (or skip) and reopens the workout on this device. */
export async function cancelFinish(sessionId: string): Promise<void> {
  for (const m of await sessionQueue(sessionId)) {
    if (isFinish(m)) await del('outbox', m.id);
  }
  await unmarkFinished(sessionId);
  await notify(sessionId);
}

/** Forgets the session's refused writes once the client has read them (their values are on screen to re-enter). */
export async function dismissRejected(sessionId: string): Promise<void> {
  for (const r of await sessionRejected(sessionId)) await del('rejected', r.id);
  await notify(sessionId);
}

type Outcome =
  | { type: 'ok'; data: unknown }
  | { type: 'retry' }
  | { type: 'blocked'; message: string }
  | { type: 'reject'; message: string };

const CLOCK = /device clock/i;

async function send(sessionId: string, kind: MutationKind, body: unknown): Promise<Outcome> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/${kind}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { type: 'retry' };
  }
  const json = (await res.json().catch(() => null)) as {
    data?: unknown;
    error?: { message?: string; fieldErrors?: Record<string, string[]> };
  } | null;
  if (res.ok) return { type: 'ok', data: json?.data };
  // Signed out, rate limited or a server fault: keep the writes for later.
  if (res.status === 401 || res.status === 429 || res.status >= 500) return { type: 'retry' };
  const fieldMessage = Object.values(json?.error?.fieldErrors ?? {}).flat()[0];
  if (res.status === 422 && fieldMessage && CLOCK.test(fieldMessage)) {
    return { type: 'blocked', message: fieldMessage };
  }
  return {
    type: 'reject',
    message: fieldMessage ?? json?.error?.message ?? 'The server refused this change.',
  };
}

/**
 * Consecutive logs writes from the head of the queue, merged to the newest value per set (at most 100 sets). Stops at
 * a blocked write: it holds back everything after it.
 */
function logsBatch(queue: Mutation[]): { batch: Mutation[]; items: SetLogPayload[] } {
  const merged = new Map<string, SetLogPayload>();
  const batch: Mutation[] = [];
  for (const m of queue) {
    if (m.kind !== 'logs' || m.blockedReason) break;
    const next = new Map(merged);
    for (const item of itemsOf(m)) {
      const prev = next.get(rowOf(item));
      if (!prev || item.clientUpdatedAt >= prev.clientUpdatedAt) next.set(rowOf(item), item);
    }
    if (next.size > MAX_BATCH && batch.length > 0) break;
    batch.push(m);
    merged.clear();
    for (const [k, v] of next) merged.set(k, v);
  }
  return { batch, items: [...merged.values()] };
}

/** Keeps writes for later: backed off after a network/server error, or blocked by the clock check. */
async function keep(
  batch: Mutation[],
  out: { type: 'retry' } | { type: 'blocked'; message: string },
) {
  for (const m of batch) {
    await put<Mutation>('outbox', {
      ...m,
      attempts: m.attempts + 1,
      ...(out.type === 'retry'
        ? { nextAttemptAt: Date.now() + backoffMs(m.attempts) }
        : { blockedReason: out.message }),
    });
  }
}

async function reject(m: Mutation, message: string): Promise<void> {
  await put<RejectedMutation>('rejected', {
    id: m.id,
    sessionId: m.sessionId,
    kind: m.kind,
    body: m.body,
    message,
    rejectedAt: Date.now(),
    userId: m.userId,
    orgId: m.orgId,
  });
  await del('outbox', m.id);
}

/** Acknowledged sets: into the device copy, and any earlier refusal of those sets is settled. */
async function acknowledged(sessionId: string, data: unknown): Promise<void> {
  const acks = (data as SetLogAck[] | undefined) ?? [];
  await applyAcks(sessionId, acks);
  const done = new Set(acks.map(rowOf));
  for (const r of await sessionRejected(sessionId)) {
    if (r.kind !== 'logs') continue;
    const left = itemsOf(r).filter((i) => !done.has(rowOf(i)));
    if (left.length === itemsOf(r).length) continue;
    if (left.length === 0) await del('rejected', r.id);
    else
      await put<RejectedMutation>('rejected', {
        ...r,
        body: { ...(r.body as object), items: left },
      });
  }
}

async function flushSession(sessionId: string, queue: Mutation[]): Promise<number> {
  let sent = 0;
  let rest = queue;
  while (rest.length > 0) {
    const head = rest[0] as Mutation;
    if (head.blockedReason) return sent;

    if (head.kind === 'logs') {
      const { batch, items } = logsBatch(rest);
      const out = await send(sessionId, 'logs', { items });
      if (out.type === 'retry' || out.type === 'blocked') {
        await keep(batch, out);
        return sent;
      }
      if (out.type === 'ok') {
        await acknowledged(sessionId, out.data);
        for (const m of batch) await del('outbox', m.id);
        sent += batch.length;
      } else if (batch.length === 1) {
        await reject(head, out.message);
      } else {
        // One refused set must not take the others down: resend the batch write by write.
        for (const m of batch) {
          const one = await send(sessionId, 'logs', { items: itemsOf(m) });
          if (one.type === 'retry' || one.type === 'blocked') {
            await keep([m], one);
            return sent;
          }
          if (one.type === 'reject') {
            await reject(m, one.message);
          } else {
            await acknowledged(sessionId, one.data);
            await del('outbox', m.id);
            sent += 1;
          }
        }
      }
      rest = rest.slice(batch.length);
      continue;
    }

    if (head.kind === 'start') {
      const out = await send(sessionId, 'start', head.body);
      if (out.type === 'retry' || out.type === 'blocked') {
        await keep([head], out);
        return sent;
      }
      if (out.type === 'reject') {
        // D-011 #3: the workout changed since the device kept it. Nothing after the start can land: every write of
        // the session is kept as refused (values intact), and the workout reads as not started.
        for (const m of rest) await reject(m, out.message);
        await unmarkStarted(sessionId);
        return sent;
      }
      const detail = out.data as SessionDetail | undefined;
      if (detail) await cacheWorkout(detail);
      await del('outbox', head.id);
      sent += 1;
      rest = rest.slice(1);
      continue;
    }

    // Complete/skip: never sent while the session's logs were refused, unless the client finishes anyway.
    if (!head.force && (await sessionRejected(sessionId)).some((r) => r.kind === 'logs')) {
      return sent;
    }
    const out = await send(sessionId, head.kind, head.body);
    if (out.type === 'retry' || out.type === 'blocked') {
      await keep([head], out);
      return sent;
    }
    if (out.type === 'reject') {
      await reject(head, out.message);
      // The device no longer shows it as finished.
      await unmarkFinished(sessionId);
    } else {
      const detail = out.data as SessionDetail | undefined;
      if (detail) await cacheWorkout(detail);
      await markFinished(sessionId, head.kind === 'complete' ? 'completed' : 'skipped');
      // Finished on the server: earlier refused finishes of this session are settled.
      for (const r of await sessionRejected(sessionId)) {
        if (isFinish(r)) await del('rejected', r.id);
      }
      await del('outbox', head.id);
      sent += 1;
    }
    rest = rest.slice(1);
  }
  return sent;
}

async function flushOnce(): Promise<FlushResult> {
  // Nobody bound (before the portal layout binds, or after sign-out): nothing is ever sent.
  if (!currentOwner()) return NOTHING;
  const now = Date.now();
  const bySession = new Map<string, Mutation[]>();
  for (const m of mine(await getAll<Mutation>('outbox'))) {
    bySession.set(m.sessionId, [...(bySession.get(m.sessionId) ?? []), m]);
  }
  let sent = 0;
  for (const [sessionId, items] of bySession) {
    const queue = items.sort(bySeq);
    const head = queue[0] as Mutation;
    if (head.blockedReason || (head.nextAttemptAt ?? 0) > now) continue;
    syncing.add(sessionId);
    await notify(sessionId);
    try {
      sent += await flushSession(sessionId, queue);
    } finally {
      syncing.delete(sessionId);
      await notify(sessionId);
    }
  }
  if (!currentOwner()) return { ...NOTHING, sent };
  const left = mine(await getAll<Mutation>('outbox'));
  const blocked = new Set(left.filter((m) => m.blockedReason).map((m) => m.id));
  return {
    sent,
    pending: left.length - blocked.size,
    blocked: blocked.size,
    rejected: mine(await getAll<RejectedMutation>('rejected')).length,
  };
}

let running: Promise<FlushResult> | null = null;
let again = false;

type LockManager = { request<T>(name: string, fn: () => Promise<T>): Promise<T> };
const locks = (): LockManager | undefined =>
  (globalThis.navigator as { locks?: LockManager } | undefined)?.locks;

/**
 * Sends what is due, one flush at a time (in this tab, and across tabs where Web Locks exist). A call during a
 * flush runs another pass after it, so a write enqueued meanwhile is not left behind.
 */
export function flush(): Promise<FlushResult> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let result: FlushResult;
    do {
      again = false;
      const lock = locks();
      result = lock ? await lock.request(LOCK, flushOnce) : await flushOnce();
    } while (again);
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

let loopUsers = 0;
let stopLoop: (() => void) | null = null;

/**
 * Flushes when the device comes back online, when the page becomes visible, and every 15 s. One loop per tab however
 * many callers (the portal layout starts it for every portal page, D-004 #4); it stops when the last caller stops.
 */
export function startSyncLoop(): () => void {
  loopUsers += 1;
  if (loopUsers === 1) {
    const run = () => void flush();
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(run, LOOP_MS);
    run();
    stopLoop = () => {
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    loopUsers -= 1;
    if (loopUsers === 0) {
      stopLoop?.();
      stopLoop = null;
    }
  };
}
