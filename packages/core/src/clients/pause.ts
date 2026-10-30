import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { localDayBounds } from '../schedule/scheduleSlots';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';

/** Ruling 6: a pause lasts 1-90 days. */
export const MAX_PAUSE_DAYS = 90;

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

const addDays = (localDate: string, days: number): string =>
  fromDbDate(new Date(toDbDate(localDate).getTime() + days * DAY_MS));

/** Whole calendar days from `a` to `b` (YYYY-MM-DD). */
const daysBetween = (a: string, b: string): number =>
  Math.round((toDbDate(b).getTime() - toDbDate(a).getTime()) / DAY_MS);

function parseDate(field: string, value: unknown): string {
  if (typeof value !== 'string' || !DATE.test(value) || fromDbDate(toDbDate(value)) !== value) {
    throw invalid(field, 'Use YYYY-MM-DD.');
  }
  return value;
}

export interface PauseView {
  startLocalDate: string;
  resumeLocalDate: string;
}

interface PauseRow {
  id: string;
  startLocalDate: Date;
  resumeLocalDate: Date;
  appliedOffsetDays: number;
}

const PAUSE_SELECT = {
  id: true,
  startLocalDate: true,
  resumeLocalDate: true,
  appliedOffsetDays: true,
} as const;

export const toPauseView = (row: { startLocalDate: Date; resumeLocalDate: Date }): PauseView => ({
  startLocalDate: fromDbDate(row.startLocalDate),
  resumeLocalDate: fromDbDate(row.resumeLocalDate),
});

/** The client's open pause, if any (RLS scopes it to the actor's organization). */
export async function openPauseOf(tx: TenantTx, clientId: string): Promise<PauseView | null> {
  const row = await tx.clientPause.findFirst({
    where: { clientId, endedAt: null },
    select: { startLocalDate: true, resumeLocalDate: true },
  });
  return row ? toPauseView(row) : null;
}

/**
 * Locks the client row (no-op update) and returns it with its open pause. Every pause operation takes this lock
 * first, then writes the pause row, so two calls for one client never interleave.
 */
async function lockClient(tx: TenantTx, clientId: string) {
  if (!isUuid(clientId)) throw notFound();
  const locked = await tx.client.updateMany({
    where: { id: clientId },
    data: { updatedAt: new Date() },
  });
  if (locked.count === 0) throw notFound();
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, status: true, timezone: true },
  });
  if (!client) throw notFound();
  const pause: PauseRow | null = await tx.clientPause.findFirst({
    where: { clientId, endedAt: null },
    select: PAUSE_SELECT,
  });
  return { client, pause };
}

/**
 * Moves the client's `scheduled` sessions dated on or after `fromLocalDate` by `delta` calendar days, recomputing
 * 00:00 / 23:59 local in each assignment's zone (DST-correct). Completed, skipped, in-progress, cancelled and missed
 * sessions never move. `fromLocalDate` is the pause start plus the offset already applied, so sessions the pause has
 * moved are exactly the ones selected, and none moves twice.
 */
async function shiftSessions(
  tx: TenantTx,
  clientId: string,
  fromLocalDate: string,
  delta: number,
): Promise<number> {
  if (delta === 0) return 0;
  const sessions = await tx.workoutSession.findMany({
    where: { clientId, state: 'scheduled', scheduledLocalDate: { gte: toDbDate(fromLocalDate) } },
    select: { id: true, scheduledLocalDate: true, assignment: { select: { timezone: true } } },
  });
  for (const s of sessions) {
    const date = addDays(fromDbDate(s.scheduledLocalDate), delta);
    const { scheduledAtUtc, dueAtUtc } = localDayBounds(date, s.assignment.timezone);
    await tx.workoutSession.update({
      where: { id: s.id },
      data: {
        scheduledLocalDate: toDbDate(date),
        scheduledAt: scheduledAtUtc,
        dueAt: dueAtUtc,
        pauseOffsetDays: { increment: delta },
      },
    });
  }
  return sessions.length;
}

function assertResume(start: string, resume: string, today: string) {
  if (resume <= start) throw invalid('resumeLocalDate', 'Pick a date after the pause starts.');
  if (resume < today) throw invalid('resumeLocalDate', "The resume date can't be in the past.");
  if (daysBetween(start, resume) > MAX_PAUSE_DAYS) {
    throw invalid('resumeLocalDate', `A pause can last at most ${MAX_PAUSE_DAYS} days.`);
  }
}

interface PauseOpts {
  now?: Date;
  requestId?: string;
}

/**
 * Pauses an active client's program (S3-5, D-003): sessions from the start date move forward by the pause length and
 * the client becomes `paused`. Replaying the same dates returns the open pause without shifting again.
 */
export async function applyPause(
  tx: TenantTx,
  actor: ActorContext,
  input: { clientId: string; startLocalDate: unknown; resumeLocalDate: unknown },
  opts: PauseOpts = {},
): Promise<{ pauseId: string; shifted: number }> {
  assertCan(actor, 'client:update');
  const { client, pause } = await lockClient(tx, input.clientId);
  const start = parseDate('startLocalDate', input.startLocalDate);
  const resume = parseDate('resumeLocalDate', input.resumeLocalDate);
  if (pause) {
    const view = toPauseView(pause);
    if (view.startLocalDate === start && view.resumeLocalDate === resume) {
      return { pauseId: pause.id, shifted: 0 };
    }
    throw new DomainError('CONFLICT', "This client's program is already paused.");
  }
  if (client.status !== 'active') {
    throw new DomainError('CONFLICT', "Only an active client's program can be paused.");
  }
  const today = todayInZone(client.timezone, opts.now ?? new Date());
  if (start < today) throw invalid('startLocalDate', "The pause can't start in the past.");
  assertResume(start, resume, today);

  const delta = daysBetween(start, resume);
  const shifted = await shiftSessions(tx, client.id, start, delta);
  // Scalar FKs only (tenant extension).
  const row = await tx.clientPause.create({
    data: {
      clientId: client.id,
      startLocalDate: toDbDate(start),
      resumeLocalDate: toDbDate(resume),
      appliedOffsetDays: delta,
      createdBy: actor.userId,
    },
    select: { id: true },
  } as Parameters<typeof tx.clientPause.create>[0]);
  await tx.client.update({ where: { id: client.id }, data: { status: 'paused' } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: client.id,
    action: 'client.paused',
    metadata: { startLocalDate: start, resumeLocalDate: resume, shifted },
    requestId: opts.requestId,
  });
  return { pauseId: row.id, shifted };
}

/** Changes the expected resume date of the open pause; sessions move by the difference only. */
export async function updatePause(
  tx: TenantTx,
  actor: ActorContext,
  input: { clientId: string; resumeLocalDate: unknown },
  opts: PauseOpts = {},
): Promise<{ shifted: number }> {
  assertCan(actor, 'client:update');
  const { client, pause } = await lockClient(tx, input.clientId);
  const resume = parseDate('resumeLocalDate', input.resumeLocalDate);
  if (!pause) throw new DomainError('NOT_FOUND', "This client's program isn't paused.");
  const start = fromDbDate(pause.startLocalDate);
  if (fromDbDate(pause.resumeLocalDate) === resume) return { shifted: 0 };
  assertResume(start, resume, todayInZone(client.timezone, opts.now ?? new Date()));

  const target = daysBetween(start, resume);
  const shifted = await shiftSessions(
    tx,
    client.id,
    addDays(start, pause.appliedOffsetDays),
    target - pause.appliedOffsetDays,
  );
  await tx.clientPause.update({
    where: { id: pause.id },
    data: { resumeLocalDate: toDbDate(resume), appliedOffsetDays: target },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: client.id,
    action: 'client.pause_updated',
    metadata: { resumeLocalDate: resume, shifted },
    requestId: opts.requestId,
  });
  return { shifted };
}

/**
 * Ends the open pause today. Sessions move back so the first one moved is due today (or, before the pause started,
 * to their original dates); the client becomes `active`.
 */
export async function resumeNow(
  tx: TenantTx,
  actor: ActorContext,
  input: { clientId: string },
  opts: PauseOpts = {},
): Promise<{ shifted: number }> {
  assertCan(actor, 'client:update');
  const { client, pause } = await lockClient(tx, input.clientId);
  if (!pause) throw new DomainError('NOT_FOUND', "This client's program isn't paused.");
  const now = opts.now ?? new Date();
  const start = fromDbDate(pause.startLocalDate);
  const today = todayInZone(client.timezone, now);
  // Never further than the pause already moved them (a due pause the worker has not ended yet stays as it is).
  const target = Math.min(pause.appliedOffsetDays, Math.max(0, daysBetween(start, today)));
  const shifted = await shiftSessions(
    tx,
    client.id,
    addDays(start, pause.appliedOffsetDays),
    target - pause.appliedOffsetDays,
  );
  await endPauseRow(tx, client, pause.id, now, { appliedOffsetDays: target });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'client',
    objectId: client.id,
    action: 'client.resumed',
    metadata: { shifted },
    requestId: opts.requestId,
  });
  return { shifted };
}

async function endPauseRow(
  tx: TenantTx,
  client: { id: string; status: string },
  pauseId: string,
  now: Date,
  data: { appliedOffsetDays?: number } = {},
) {
  await tx.clientPause.update({ where: { id: pauseId }, data: { ...data, endedAt: now } });
  // An archived client stays archived; only a paused one becomes active again.
  if (client.status === 'paused') {
    await tx.client.update({ where: { id: client.id }, data: { status: 'active' } });
  }
}

/**
 * System code (worker): ends the client's open pause when its resume date has arrived in the client's zone. No
 * session moves (they already sit after the resume date). Safe to run repeatedly: returns false when there is
 * nothing to end.
 */
export async function endDuePause(
  tx: TenantTx,
  orgId: string,
  clientId: string,
  now: Date,
): Promise<boolean> {
  const { client, pause } = await lockClient(tx, clientId);
  if (!pause) return false;
  if (fromDbDate(pause.resumeLocalDate) > todayInZone(client.timezone, now)) return false;
  await endPauseRow(tx, client, pause.id, now);
  await appendAudit(tx, {
    orgId,
    actorId: null,
    objectType: 'client',
    objectId: client.id,
    action: 'client.resumed',
    metadata: { automatic: true },
  });
  return true;
}

/**
 * Closes the open pause when a paused client is archived (called from updateClient under its write). Sessions stay
 * where the pause put them; the client's status is set by the caller.
 */
export async function closePauseOnArchive(tx: TenantTx, clientId: string, now: Date) {
  await tx.clientPause.updateMany({ where: { clientId, endedAt: null }, data: { endedAt: now } });
}
