import { z } from 'zod';
import type { TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { lockSession, markCoachLogged } from '../sessions/lifecycle';
import { MAX_CLOCK_SKEW_MS, setLogInputSchema, type ParsedSetLog } from './schema';
import { toSetLogValue, type SetLogValue } from './values';

export interface SetLogAck {
  workoutVersionExerciseId: string;
  setIndex: number;
  clientMutationId: string;
  /** `stale`: an older write than the stored one; it was ignored and `value` is what the server keeps. */
  status: 'saved' | 'stale';
  value: SetLogValue;
}

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

/** Validates a batch (1–100 items) against `setLogInputSchema` and refuses device clocks too far ahead. */
export function parseSetLogItems(items: unknown, now: Date): ParsedSetLog[] {
  const parsed = z.array(setLogInputSchema).min(1).max(100).safeParse(items);
  if (!parsed.success) {
    const messages = parsed.error.issues
      .slice(0, 5)
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
    throw new DomainError('VALIDATION', 'Some fields are invalid.', { items: messages });
  }
  for (const item of parsed.data) {
    if (new Date(item.clientUpdatedAt).getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
      throw invalid('items', "The device clock is ahead of the server's. Check its date and time.");
    }
  }
  return parsed.data;
}

/** Only the fields the device sent: an omitted field keeps its stored value, `null` clears it. */
export function providedValues(item: ParsedSetLog) {
  const out: Record<string, number | null> = {};
  for (const key of ['reps', 'weightKg', 'rpe', 'durationSeconds', 'distanceM'] as const) {
    const v = item[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/**
 * Per-set logging (F08, D-004 #7). Each item upserts on (session, workout version exercise, set index), so the same
 * payload sent any number of times leaves one row per set (Review Focus #2). A write whose `clientUpdatedAt` is older
 * than the stored one is ignored and acknowledged `stale` (the newest device write wins, D-004 builder note).
 * The session must be in progress, and every exercise must belong to its locked version; otherwise nothing is
 * written. The session row lock serializes concurrent batches for one session.
 */
export async function upsertSetLogs(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: string,
  items: unknown,
  opts: { now?: Date; requestId?: string } = {},
): Promise<SetLogAck[]> {
  assertCan(actor, 'session:log');
  const now = opts.now ?? new Date();
  const parsed = parseSetLogItems(items, now);
  const session = await lockSession(tx, actor, sessionId);
  if (session.state === 'scheduled') {
    throw new DomainError('SESSION_NOT_STARTED', 'Start the workout before logging sets.');
  }
  // An incomplete session (past due + grace, S4-2) still takes a late sync of its sets.
  if (
    (session.state !== 'in_progress' && session.state !== 'incomplete') ||
    session.workoutVersionId === null
  ) {
    throw new DomainError(
      'SESSION_FINISHED',
      'This workout is already finished and can no longer change.',
    );
  }

  const allowed = new Set(
    (
      await tx.workoutVersionExercise.findMany({
        where: { workoutVersionId: session.workoutVersionId },
        select: { id: true },
      })
    ).map((e) => e.id),
  );
  if (parsed.some((i) => !allowed.has(i.workoutVersionExerciseId))) {
    throw invalid('items', "This exercise isn't part of this workout.");
  }

  const acks: SetLogAck[] = [];
  for (const item of parsed) {
    const key = {
      sessionId: session.id,
      workoutVersionExerciseId: item.workoutVersionExerciseId,
      setIndex: item.setIndex,
    };
    const clientUpdatedAt = new Date(item.clientUpdatedAt);
    const existing = await tx.setLog.findFirst({ where: key });
    let row;
    let status: SetLogAck['status'] = 'saved';
    if (!existing) {
      row = await tx.setLog.create({
        data: {
          ...key,
          ...providedValues(item),
          clientUpdatedAt,
          clientMutationId: item.clientMutationId,
          loggedByUserId: actor.userId,
        },
      } as Parameters<typeof tx.setLog.create>[0]);
    } else if (clientUpdatedAt < existing.clientUpdatedAt) {
      row = existing;
      status = 'stale';
    } else if (
      clientUpdatedAt.getTime() === existing.clientUpdatedAt.getTime() &&
      item.clientMutationId === existing.clientMutationId
    ) {
      row = existing; // A replay of the write already stored.
    } else {
      await tx.setLog.updateMany({
        where: { id: existing.id },
        data: {
          ...providedValues(item),
          clientUpdatedAt,
          clientMutationId: item.clientMutationId,
          loggedByUserId: actor.userId,
        },
      });
      row = await tx.setLog.findFirstOrThrow({ where: { id: existing.id } });
    }
    acks.push({
      workoutVersionExerciseId: item.workoutVersionExerciseId,
      setIndex: item.setIndex,
      clientMutationId: item.clientMutationId,
      status,
      value: toSetLogValue(row),
    });
  }
  await markCoachLogged(tx, actor, session, opts.requestId);
  return acks;
}
