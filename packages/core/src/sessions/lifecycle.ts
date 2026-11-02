import { appendAudit, type TenantTx } from '@kinetic/db';
import { emitClientEvent } from '../automations/events';
import { promoteOnFirstCompletion } from '../clients/stage';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { COMMENT_MAX } from '../logging/schema';
import { resolveStaleMissedFlags } from '../review/rules';
import { isUuid } from '../uuid';
import { getSessionDetail, type SessionDetail } from './detail';
import { sessionScope } from './read';
import { resolveSlotWorkoutVersionId } from './resolve';
import type { SessionState } from './types';

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
/** States a complete or skip may still end (missed and incomplete are derived, S4-2). */
const FINISHABLE: SessionState[] = ['scheduled', 'in_progress', 'missed', 'incomplete'];
const finished = () =>
  new DomainError('SESSION_FINISHED', 'This workout is already finished and can no longer change.');

export interface LockedSession {
  id: string;
  clientId: string;
  /** Null, with the slot, for an extra workout (PRD D13). */
  assignmentId: string | null;
  slotWeekIndex: number | null;
  slotDayIndex: number | null;
  state: SessionState;
  workoutVersionId: string | null;
  loggedByUserId: string | null;
  /** When the session was completed or skipped (the start of the client's 24h edit window, S3-4). */
  submittedAt: Date | null;
}

/**
 * Locks the session row for the rest of the transaction, so every write to one session (start, set logs, finish)
 * runs one at a time; the re-read afterwards sees whatever a concurrent writer committed. A client actor reaches
 * only their own sessions; anything else is NOT_FOUND (never 403). No raw SQL in TenantTx: a no-op UPDATE takes the
 * same row lock as SELECT ... FOR UPDATE.
 */
export async function lockSession(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: string,
): Promise<LockedSession> {
  if (!isUuid(sessionId)) throw notFound();
  // Nobody logs for an archived client (D-010 #4): their sessions are read-only history.
  const where = {
    id: sessionId,
    ...sessionScope(actor),
    client: { is: { status: { not: 'archived' as const } } },
  };
  const locked = await tx.workoutSession.updateMany({
    where,
    data: { pauseOffsetDays: { increment: 0 } },
  });
  if (locked.count === 0) throw notFound();
  const row = await tx.workoutSession.findFirst({
    where,
    select: {
      id: true,
      clientId: true,
      assignmentId: true,
      slotWeekIndex: true,
      slotDayIndex: true,
      state: true,
      workoutVersionId: true,
      loggedByUserId: true,
      submittedAt: true,
    },
  });
  if (!row) throw notFound();
  return row;
}

/**
 * D-008 #7: the first time a coach (owner/coach role) writes to a session it is marked "logged by coach" and audited
 * once. Client writes never touch it.
 */
export async function markCoachLogged(
  tx: TenantTx,
  actor: ActorContext,
  session: LockedSession,
  requestId?: string,
): Promise<void> {
  if (actor.role === 'client' || session.loggedByUserId !== null) return;
  await tx.workoutSession.updateMany({
    where: { id: session.id, loggedByUserId: null },
    data: { loggedByUserId: actor.userId },
  });
  session.loggedByUserId = actor.userId;
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'session',
    objectId: session.id,
    action: 'session.logged_by_coach',
    metadata: { clientId: session.clientId },
    requestId,
  });
}

interface Opts {
  now?: Date;
  requestId?: string;
}

export interface StartOpts extends Opts {
  /** PRD D4: set by a start queued offline, with the version the device showed. */
  expectedWorkoutVersionId?: string;
  /** PRD D4: when the client tapped Start offline. */
  startedAt?: string;
}

/** D-011 #3: the workout changed after the device kept it, so the offline start is refused. */
const changedSinceCached = () =>
  new DomainError(
    'CONFLICT',
    'Your coach changed this workout after it was saved on your device. Open it again online to start it.',
  );

/** How far back an offline start time is believed (PRD D4); anything else is the server's time. */
const OFFLINE_START_MAX_MS = 7 * 24 * 3_600_000;

/** The start time a device recorded offline, if it is plausible; otherwise `now`. */
export function offlineStartedAt(startedAt: string | undefined, now: Date): Date {
  if (!startedAt) return now;
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t) || t > now.getTime() || now.getTime() - t > OFFLINE_START_MAX_MS)
    return now;
  return new Date(t);
}

/**
 * Start Workout (D-002 #6): locks the slot's current WorkoutVersion permanently and moves the session to
 * `in_progress`. Idempotent: starting an in-progress session (double tap, retry, a second tab) returns it unchanged,
 * and concurrent starts lock one version. Finished sessions can't restart.
 */
export async function startSession(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: string,
  opts: StartOpts = {},
): Promise<SessionDetail> {
  assertCan(actor, 'session:log');
  const now = opts.now ?? new Date();
  const session = await lockSession(tx, actor, sessionId);
  const expected = opts.expectedWorkoutVersionId;
  if (session.state === 'in_progress') {
    if (expected && session.workoutVersionId !== expected) throw changedSinceCached();
    return getSessionDetail(tx, actor, session.id, { now });
  }
  // A missed session may still be started late (S4-2 Ruling 4); its version was locked by the sweep.
  if (session.state !== 'scheduled' && session.state !== 'missed') throw finished();

  // A version already locked is never replaced (D-002 #6; the database refuses it too, migration 000019).
  const workoutVersionId =
    session.workoutVersionId ?? (await resolveSlotWorkoutVersionId(tx, session));
  // D-011 #3: a start made offline counts only if the device showed the version this start locks.
  if (expected && workoutVersionId !== expected) throw changedSinceCached();
  await tx.workoutSession.updateMany({
    where: { id: session.id, state: { in: ['scheduled', 'missed'] } },
    data: {
      state: 'in_progress',
      workoutVersionId,
      startedAt: offlineStartedAt(opts.startedAt, now),
    },
  });
  if (session.state === 'missed') await resolveStaleMissedFlags(tx, now, session.clientId);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'session',
    objectId: session.id,
    action: 'session.started',
    metadata: { clientId: session.clientId, workoutVersionId },
    requestId: opts.requestId,
  });
  await markCoachLogged(tx, actor, session, opts.requestId);
  return getSessionDetail(tx, actor, session.id, { now });
}

export interface FinishInput {
  idempotencyKey: string;
  comment?: string;
}

function cleanComment(comment: string | undefined): string | null {
  const c = comment?.trim() ?? '';
  if (c.length > COMMENT_MAX) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      comment: [`Use at most ${COMMENT_MAX} characters.`],
    });
  }
  return c === '' ? null : c;
}

async function finishSession(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: string,
  kind: 'completed' | 'skipped',
  input: FinishInput,
  opts: Opts,
): Promise<SessionDetail> {
  assertCan(actor, 'session:log');
  if (!isUuid(input.idempotencyKey)) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', {
      idempotencyKey: ['Invalid.'],
    });
  }
  const comment = cleanComment(input.comment);
  const now = opts.now ?? new Date();
  const session = await lockSession(tx, actor, sessionId);
  // Replay of the same action (retry, double tap, outbox replay): the stored outcome, no second write or audit.
  if (session.state === kind) return getSessionDetail(tx, actor, session.id, { now });
  // Missed and incomplete are derived, not final (S4-2 Ruling 4): a late sync may still finish them.
  if (!FINISHABLE.includes(session.state)) throw finished();

  // Completing or skipping without starting still locks the version (D-002 #6).
  const workoutVersionId =
    session.workoutVersionId ?? (await resolveSlotWorkoutVersionId(tx, session));
  await tx.workoutSession.updateMany({
    where: { id: session.id, state: { in: FINISHABLE } },
    data: {
      state: kind,
      workoutVersionId,
      submittedAt: now,
      ...(kind === 'completed' ? { completedAt: now } : {}),
      comment,
    },
  });
  const setCount = await tx.setLog.count({ where: { sessionId: session.id } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'session',
    objectId: session.id,
    action: kind === 'completed' ? 'session.completed' : 'session.skipped',
    // Never the comment text (free text stays out of audit payloads).
    metadata: {
      clientId: session.clientId,
      idempotencyKey: input.idempotencyKey,
      setCount,
      hasComment: comment !== null,
    },
    requestId: opts.requestId,
  });
  await markCoachLogged(tx, actor, session, opts.requestId);
  // PRD B20: the first completed workout ends onboarding.
  if (kind === 'completed') await promoteOnFirstCompletion(tx, session.clientId);
  // PRD J2: the last planned workout of a program finished it.
  if (session.assignmentId) {
    const open = await tx.workoutSession.count({
      where: {
        assignmentId: session.assignmentId,
        kind: 'planned',
        state: { in: ['scheduled', 'in_progress', 'missed', 'incomplete'] },
      },
    });
    const already = await tx.clientEvent.count({
      where: {
        clientId: session.clientId,
        kind: 'program_finished',
        detailJson: { path: ['assignmentId'], equals: session.assignmentId },
      },
    });
    if (open === 0 && already === 0) {
      await emitClientEvent(tx, session.clientId, 'program_finished', {
        assignmentId: session.assignmentId,
      });
    }
  }
  // A late finish can end a missed-workouts episode (S4-2: Rule 1 is re-evaluated).
  if (session.state === 'missed') await resolveStaleMissedFlags(tx, now, session.clientId);
  return getSessionDetail(tx, actor, session.id, { now });
}

/** Complete a scheduled or in-progress session. Idempotent per session (Review Focus #2). */
export function completeSession(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: string,
  input: FinishInput,
  opts: Opts = {},
): Promise<SessionDetail> {
  return finishSession(tx, actor, sessionId, 'completed', input, opts);
}

/** Skip a scheduled or in-progress session (an explicit client choice, D-008 #4). Idempotent per session. */
export function skipSession(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: string,
  input: FinishInput,
  opts: Opts = {},
): Promise<SessionDetail> {
  return finishSession(tx, actor, sessionId, 'skipped', input, opts);
}
