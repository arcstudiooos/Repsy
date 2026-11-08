import { appendAudit, type TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { lockSession } from '../sessions/lifecycle';
import { parseSetLogItems, providedValues, type SetLogAck } from './upsertSetLogs';
import { EDIT_WINDOW_MS, REVISION_REASON_MAX } from './schema';
import { toSetLogValue, type RevisionValues } from './values';

export interface ReviseInput {
  items: unknown;
  /** Required (1–500 after trimming) for a coach's correction; optional for the client's own edit. */
  reason?: unknown;
}

const FIELDS = ['reps', 'weightKg', 'rpe', 'durationSeconds', 'distanceM'] as const;
const EMPTY: RevisionValues = {
  reps: null,
  weightKg: null,
  rpe: null,
  durationSeconds: null,
  distanceM: null,
};

const reasonError = (message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { reason: [message] });

function cleanReason(reason: unknown, required: boolean): string | null {
  if (reason !== undefined && reason !== null && typeof reason !== 'string') {
    throw reasonError('Enter the reason as text.');
  }
  const r = (reason ?? '').trim();
  if (r.length > REVISION_REASON_MAX) {
    throw reasonError(`Use at most ${REVISION_REASON_MAX} characters.`);
  }
  if (r === '') {
    if (required) throw reasonError('Add a reason for the correction.');
    return null;
  }
  return r;
}

const pick = (v: RevisionValues): RevisionValues =>
  Object.fromEntries(FIELDS.map((f) => [f, v[f]])) as unknown as RevisionValues;
const same = (a: RevisionValues, b: RevisionValues) => FIELDS.every((f) => a[f] === b[f]);

/**
 * Edits the log of a finished (completed or skipped) workout (S3-4, Ruling 5). The client may edit their own session
 * until 24 hours after submitting it (reason optional); a coach may correct it at any time with a reason. Each item
 * overwrites the set's values (omitted fields keep theirs, `null` clears one; a cleared set stays as an all-null row).
 * Every actual change writes one append-only `SetLogRevision`; an item that changes nothing writes nothing. The
 * workout version and the session's lock never change (D-008 clar. 2). The audit event carries counts only.
 */
export async function reviseSetLogs(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: string,
  input: ReviseInput,
  opts: { now?: Date; requestId?: string } = {},
): Promise<SetLogAck[]> {
  assertCan(actor, 'session:log');
  const now = opts.now ?? new Date();
  const role = actor.role === 'client' ? 'client' : 'coach';
  const parsed = parseSetLogItems(input.items, now);
  const reason = cleanReason(input.reason, role === 'coach');
  // A client actor reaches only their own sessions; anything else is NOT_FOUND (Review Focus #4).
  const session = await lockSession(tx, actor, sessionId);
  if (session.state === 'in_progress') {
    throw new DomainError('CONFLICT', 'This workout is still in progress.');
  }
  if (session.state === 'scheduled') {
    throw new DomainError('SESSION_NOT_STARTED', 'Start the workout before logging sets.');
  }
  if (
    (session.state !== 'completed' && session.state !== 'skipped') ||
    session.workoutVersionId === null
  ) {
    throw new DomainError(
      'SESSION_FINISHED',
      'This workout is already finished and can no longer change.',
    );
  }
  if (role === 'client') {
    const closesAt = (session.submittedAt?.getTime() ?? -Infinity) + EDIT_WINDOW_MS;
    if (now.getTime() > closesAt) {
      throw new DomainError(
        'EDIT_WINDOW_CLOSED',
        'You can edit a workout for 24 hours after finishing it.',
      );
    }
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
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      items: ["This exercise isn't part of this workout."],
    });
  }

  const acks: SetLogAck[] = [];
  let revisionCount = 0;
  for (const item of parsed) {
    const key = {
      sessionId: session.id,
      workoutVersionExerciseId: item.workoutVersionExerciseId,
      setIndex: item.setIndex,
    };
    const existing = await tx.setLog.findFirst({ where: key });
    const before = existing ? pick(toSetLogValue(existing)) : null;
    const after: RevisionValues = { ...(before ?? EMPTY), ...providedValues(item) };
    const ack = {
      workoutVersionExerciseId: item.workoutVersionExerciseId,
      setIndex: item.setIndex,
      clientMutationId: item.clientMutationId,
      status: 'saved' as const,
    };
    if (same(before ?? EMPTY, after)) {
      // Nothing changes (also a blank set that was never logged): no write, no revision.
      acks.push({
        ...ack,
        value: existing
          ? toSetLogValue(existing)
          : { ...EMPTY, clientUpdatedAt: new Date(item.clientUpdatedAt).toISOString() },
      });
      continue;
    }
    const data = {
      ...providedValues(item),
      clientUpdatedAt: new Date(item.clientUpdatedAt),
      clientMutationId: item.clientMutationId,
      loggedByUserId: actor.userId,
    };
    let setLogId: string;
    if (existing) {
      await tx.setLog.updateMany({ where: { id: existing.id }, data });
      setLogId = existing.id;
    } else {
      const created = await tx.setLog.create({
        data: { ...key, ...data },
      } as Parameters<typeof tx.setLog.create>[0]);
      setLogId = created.id;
    }
    const row = await tx.setLog.findFirstOrThrow({ where: { id: setLogId } });
    await tx.setLogRevision.create({
      data: {
        setLogId,
        sessionId: session.id,
        ...(before ? { beforeJson: { ...before } } : {}),
        afterJson: { ...pick(toSetLogValue(row)) },
        reason,
        revisedBy: actor.userId,
        revisedByRole: role,
      },
    } as Parameters<typeof tx.setLogRevision.create>[0]);
    revisionCount++;
    acks.push({ ...ack, value: toSetLogValue(row) });
  }

  if (revisionCount > 0) {
    await appendAudit(tx, {
      orgId: actor.orgId,
      actorId: actor.userId,
      objectType: 'session',
      objectId: session.id,
      action: 'session.logs_revised',
      // Content-free: never the reason text or the values.
      metadata: { revisionCount, role },
      requestId: opts.requestId,
    });
  }
  return acks;
}
