/**
 * The portal's write queue (S3-3, D-004): every set log, completion and skip is stored on the device first, then
 * replayed against the existing idempotent endpoints (set logs upsert on `clientUpdatedAt`, complete/skip carry an
 * idempotency key), so a replay never double-applies. Per session the queue is FIFO: logs always reach the server
 * before that session's completion. "Synced" means the server acknowledged every queued write for the session.
 */
import type { SessionDetail, SetLogAck } from '@kinetic/core';
import type { SetLogPayload } from '@/lib/workout-api';
import { del, getAll, getBySession, put } from './db';
import { applyAcks, cacheWorkout, markFinished } from './workoutCache';

export type MutationKind = 'logs' | 'complete' | 'skip';

export interface Mutation {
  /** `clientMutationId` for logs, the idempotency key for complete/skip. */
  id: string;
  sessionId: string;
  kind: MutationKind;
  /** `{ items: SetLogPayload[] }` for logs; `{ idempotencyKey, comment? }` for complete/skip. */
  body: unknown;
  createdAt: number;
  attempts: number;
  /** Not retried before this time (ms) after a network or server error. */
  nextAttemptAt?: number;
  /** Set when the server refused the device clock; the session's queue waits for `retryBlocked`. */
  blockedReason?: string;
}

export interface RejectedMutation {
  id: string;
  sessionId: string;
  kind: MutationKind;
  message: string;
  rejectedAt: number;
}

export type SyncStatus = 'saved_on_device' | 'syncing' | 'synced';

export interface SyncState {
  status: SyncStatus;
  blockedReason?: string;
  rejected: { message: string }[];
  /** `${workoutVersionExerciseId}:${setIndex}` of sets still waiting for the server. */
  pendingRows: string[];
}

export interface FlushResult {
  sent: number;
  pending: number;
  blocked: number;
  rejected: number;
}

const MAX_BATCH = 100;
const MAX_BACKOFF_MS = 60_000;
const LOOP_MS = 15_000;
const LOCK = 'kinetic-outbox';

const backoffMs = (attempts: number) => Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts);
const itemsOf = (m: Mutation): SetLogPayload[] =>
  m.kind === 'logs' ? ((m.body as { items?: SetLogPayload[] }).items ?? []) : [];
const rowOf = (i: { workoutVersionExerciseId: string; setIndex: number }) =>
  `${i.workoutVersionExerciseId}:${i.setIndex}`;

// --- listeners -------------------------------------------------------------------------------------------------

const listeners = new Map<string, Set<(s: SyncState) => void>>();
const syncing = new Set<string>();

export async function syncState(sessionId: string): Promise<SyncState> {
  const items = await getBySession<Mutation>('outbox', sessionId);
  const rejected = await getBySession<RejectedMutation>('rejected', sessionId);
  return {
    status: items.length === 0 ? 'synced' : syncing.has(sessionId) ? 'syncing' : 'saved_on_device',
    blockedReason: items.find((m) => m.blockedReason)?.blockedReason,
    rejected: rejected
      .sort((a, b) => a.rejectedAt - b.rejectedAt)
      .map((r) => ({ message: r.message })),
    pendingRows: [...new Set(items.flatMap((m) => itemsOf(m).map(rowOf)))],
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

/** Stores a write (re-enqueueing the same id replaces it) and starts a flush. */
export async function enqueue(m: Omit<Mutation, 'createdAt' | 'attempts'>): Promise<void> {
  const existing = (await getBySession<Mutation>('outbox', m.sessionId)).find((x) => x.id === m.id);
  await put<Mutation>('outbox', {
    ...m,
    createdAt: existing?.createdAt ?? Date.now(),
    attempts: 0,
  });
  await notify(m.sessionId);
  void flush();
}

/** Clears the clock block of a session's queue and sends it again. */
export async function retryBlocked(sessionId: string): Promise<void> {
  for (const m of await getBySession<Mutation>('outbox', sessionId)) {
    await put<Mutation>('outbox', {
      ...m,
      attempts: 0,
      blockedReason: undefined,
      nextAttemptAt: undefined,
    });
  }
  await notify(sessionId);
  await flush();
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

/** Consecutive logs writes from the head of the queue, merged to the newest value per set (at most 100 sets). */
function logsBatch(queue: Mutation[]): { batch: Mutation[]; items: SetLogPayload[] } {
  const merged = new Map<string, SetLogPayload>();
  const batch: Mutation[] = [];
  for (const m of queue) {
    if (m.kind !== 'logs') break;
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

async function flushSession(sessionId: string, queue: Mutation[]): Promise<number> {
  let sent = 0;
  let rest = queue;
  while (rest.length > 0) {
    const head = rest[0] as Mutation;
    const { batch, body } =
      head.kind === 'logs'
        ? (() => {
            const b = logsBatch(rest);
            return { batch: b.batch, body: { items: b.items } };
          })()
        : { batch: [head], body: head.body };
    const out = await send(sessionId, head.kind, body);
    if (out.type === 'retry' || out.type === 'blocked') {
      for (const m of batch) {
        await put<Mutation>('outbox', {
          ...m,
          attempts: m.attempts + 1,
          ...(out.type === 'retry'
            ? { nextAttemptAt: Date.now() + backoffMs(m.attempts) }
            : { blockedReason: out.message }),
        });
      }
      return sent;
    }
    if (out.type === 'reject') {
      for (const m of batch) {
        await put<RejectedMutation>('rejected', {
          id: m.id,
          sessionId,
          kind: m.kind,
          message: out.message,
          rejectedAt: Date.now(),
        });
      }
    } else if (head.kind === 'logs') {
      await applyAcks(sessionId, (out.data as SetLogAck[] | undefined) ?? []);
    } else {
      const detail = out.data as SessionDetail | undefined;
      if (detail) await cacheWorkout(detail);
      await markFinished(sessionId, head.kind === 'complete' ? 'completed' : 'skipped');
    }
    for (const m of batch) await del('outbox', m.id);
    sent += out.type === 'ok' ? batch.length : 0;
    rest = rest.slice(batch.length);
  }
  return sent;
}

async function flushOnce(): Promise<FlushResult> {
  const now = Date.now();
  const bySession = new Map<string, Mutation[]>();
  for (const m of await getAll<Mutation>('outbox')) {
    bySession.set(m.sessionId, [...(bySession.get(m.sessionId) ?? []), m]);
  }
  let sent = 0;
  for (const [sessionId, items] of bySession) {
    const queue = items.sort((a, b) => a.createdAt - b.createdAt);
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
  const left = await getAll<Mutation>('outbox');
  const blocked = new Set(left.filter((m) => m.blockedReason).map((m) => m.id));
  return {
    sent,
    pending: left.length - blocked.size,
    blocked: blocked.size,
    rejected: (await getAll<RejectedMutation>('rejected')).length,
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

/** Flushes when the device comes back online, when the page becomes visible, and every 15 s. */
export function startSyncLoop(): () => void {
  const run = () => void flush();
  const onVisible = () => {
    if (document.visibilityState === 'visible') run();
  };
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVisible);
  const timer = window.setInterval(run, LOOP_MS);
  run();
  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(timer);
  };
}
