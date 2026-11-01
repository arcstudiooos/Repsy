/**
 * PRD D20: the weekly integrity check. Once every 7 days, on a portal page that is online, each workout still on the
 * device (and with nothing waiting in its outbox) is compared with the server's copy. A set the device holds that the
 * server lacks, or holds older, is queued again (with its original time, so the newest value still wins and a replay
 * stays idempotent). Typed rows of workouts no longer on the device are dropped.
 */
import type { LoggedSet, SessionDetail } from '@kinetic/core';
import type { SetLogPayload } from '@/lib/workout-api';
import { countOutbox, del, getAll, getBySession, getMeta, setMeta } from './db';
import { enqueue, type RejectedMutation } from './outbox';
import { cacheWorkout, type CachedWorkout, type StoredDraft } from './workoutCache';

export const INTEGRITY_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const KEY = 'integrityAt';

const rowOf = (l: { workoutVersionExerciseId: string; setIndex: number }) =>
  `${l.workoutVersionExerciseId}:${l.setIndex}`;

export interface IntegrityResult {
  checked: number;
  /** Sets queued again because the server did not hold the device's value. */
  resent: number;
}

async function serverDetail(sessionId: string): Promise<SessionDetail | null> {
  try {
    const res = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
      credentials: 'same-origin',
    });
    if (!res.ok) return null;
    return ((await res.json()) as { data: SessionDetail }).data;
  } catch {
    return null;
  }
}

/** The device's sets the server doesn't hold (missing, or an older value), leaving out sets it refused. */
export function missingOnServer(
  local: LoggedSet[],
  server: LoggedSet[],
  refused: Set<string>,
): LoggedSet[] {
  const held = new Map(server.map((l) => [rowOf(l), l]));
  return local.filter((l) => {
    if (refused.has(rowOf(l))) return false;
    const s = held.get(rowOf(l));
    return !s || s.clientUpdatedAt < l.clientUpdatedAt;
  });
}

/** Runs the check if it is due. Returns null when it was not due (or the device was offline for all of it). */
export async function checkIntegrity(
  opts: { now?: number; fetchDetail?: (id: string) => Promise<SessionDetail | null> } = {},
): Promise<IntegrityResult | null> {
  const now = opts.now ?? Date.now();
  const fetchDetail = opts.fetchDetail ?? serverDetail;
  const last = await getMeta<number>(KEY);
  if (last !== undefined && now - last < INTEGRITY_EVERY_MS) return null;
  const workouts = await getAll<CachedWorkout>('workouts');
  let checked = 0;
  let resent = 0;
  let reached = workouts.length === 0;
  for (const w of workouts) {
    if ((await countOutbox(w.sessionId)) > 0) continue;
    const server = await fetchDetail(w.sessionId);
    if (!server) continue;
    reached = true;
    checked += 1;
    const refused = new Set<string>();
    for (const r of await getBySession<RejectedMutation>('rejected', w.sessionId)) {
      for (const i of (r.body as { items?: SetLogPayload[] }).items ?? []) refused.add(rowOf(i));
    }
    const missing = missingOnServer(w.local, server.logs, refused);
    await cacheWorkout(server);
    if (missing.length > 0) {
      const items: SetLogPayload[] = missing.map((l) => ({
        ...l,
        clientMutationId: crypto.randomUUID(),
      }));
      await enqueue({
        id: items[0]!.clientMutationId,
        sessionId: w.sessionId,
        kind: 'logs',
        body: { items },
      });
      resent += missing.length;
    }
  }
  const kept = new Set(workouts.map((w) => w.sessionId));
  for (const d of await getAll<StoredDraft>('drafts')) {
    if (!kept.has(d.sessionId)) await del('drafts', d.id);
  }
  if (!reached) return null;
  await setMeta(KEY, now);
  return { checked, resent };
}
