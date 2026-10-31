import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { localDayBounds } from '../schedule/scheduleSlots';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';
import { fromDbDate, sessionScope, summarize, SUMMARY_SELECT, toDbDate } from './read';
import type { SessionState } from './types';

const DAY_MS = 86_400_000;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** How far ahead a workout may be moved: past the longest program (104 weeks) is never needed. */
export const RESCHEDULE_MAX_DAYS_AHEAD = 731;

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

const addDays = (localDate: string, days: number): string =>
  fromDbDate(new Date(toDbDate(localDate).getTime() + days * DAY_MS));
const daysBetween = (a: string, b: string): number =>
  Math.round((toDbDate(b).getTime() - toDbDate(a).getTime()) / DAY_MS);

export interface CalendarWorkout {
  id: string;
  date: string;
  title: string;
  state: SessionState;
  overdue: boolean;
  /** Unstarted and movable (scheduled, today or later, no open pause). */
  movable: boolean;
}

export interface CalendarCheckin {
  id: string;
  date: string;
  status: 'open' | 'sent' | 'reviewed';
}

export interface ClientCalendar {
  /** YYYY-MM shown. */
  month: string;
  /** Monday on or before the 1st through the Sunday on or after the last day: whole weeks. */
  gridStart: string;
  gridEnd: string;
  todayLocalDate: string;
  timezone: string;
  workouts: CalendarWorkout[];
  checkins: CalendarCheckin[];
  /** The open pause, if any; workouts cannot be moved while it lasts. */
  pause: { startLocalDate: string; resumeLocalDate: string } | null;
}

function monthGrid(month: string): { gridStart: string; gridEnd: string } {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = fromDbDate(new Date(Date.UTC(y, m, 0)));
  const dow = (d: string) => {
    const w = toDbDate(d).getUTCDay();
    return w === 0 ? 7 : w;
  };
  return { gridStart: addDays(first, 1 - dow(first)), gridEnd: addDays(last, 7 - dow(last)) };
}

/** The local date (YYYY-MM-DD) of `instant` in `timeZone`. */
const localDateOf = (instant: Date, timeZone: string) => todayInZone(timeZone, instant);

/**
 * A month of one client's plan (PRD C16): workouts on their scheduled dates and weekly check-ins on their due dates,
 * in the client's time zone, over whole Monday-Sunday weeks. Cancelled workouts are never shown (D-002 #7).
 * A client actor always gets their own calendar.
 */
export async function getClientCalendar(
  tx: TenantTx,
  actor: ActorContext,
  input: { clientId?: string; month?: string },
  opts: { now?: Date } = {},
): Promise<ClientCalendar> {
  assertCan(actor, 'session:read');
  const now = opts.now ?? new Date();
  const scope = sessionScope(actor);
  const clientId = scope.clientId ?? input.clientId;
  if (!isUuid(clientId)) throw notFound();
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, timezone: true },
  });
  if (!client) throw notFound();
  const today = todayInZone(client.timezone, now);
  const month = input.month ?? today.slice(0, 7);
  if (!MONTH.test(month)) throw invalid('month', 'Use YYYY-MM.');
  const { gridStart, gridEnd } = monthGrid(month);

  const pauseRow = await tx.clientPause.findFirst({
    where: { clientId: client.id, endedAt: null },
    select: { startLocalDate: true, resumeLocalDate: true },
  });
  const pause = pauseRow
    ? {
        startLocalDate: fromDbDate(pauseRow.startLocalDate),
        resumeLocalDate: fromDbDate(pauseRow.resumeLocalDate),
      }
    : null;

  const rows = await tx.workoutSession.findMany({
    where: {
      clientId: client.id,
      state: { not: 'cancelled' },
      scheduledLocalDate: { gte: toDbDate(gridStart), lte: toDbDate(gridEnd) },
    },
    orderBy: [{ scheduledLocalDate: 'asc' }, { slotWeekIndex: 'asc' }, { slotDayIndex: 'asc' }],
    select: SUMMARY_SELECT,
  });
  const summaries = await summarize(tx, rows, now);
  const canMove = actor.role !== 'client' && pause === null;
  const workouts: CalendarWorkout[] = summaries.map((s) => ({
    id: s.id,
    date: s.scheduledLocalDate,
    title: s.title,
    state: s.state,
    overdue: s.overdue,
    movable: canMove && s.state === 'scheduled' && s.scheduledLocalDate >= today,
  }));

  // Check-ins are due 23:59 local, so the due instant's local date is the check-in day. A day of slack each side
  // catches zone offsets; the local-date filter below is exact.
  const checkinRows = await tx.checkin.findMany({
    where: {
      clientId: client.id,
      dueAt: {
        gte: new Date(toDbDate(gridStart).getTime() - DAY_MS),
        lte: new Date(toDbDate(gridEnd).getTime() + 2 * DAY_MS),
      },
    },
    orderBy: { dueAt: 'asc' },
    select: { id: true, dueAt: true, submittedAt: true, reviewedAt: true },
  });
  const checkins: CalendarCheckin[] = checkinRows
    .map((c) => ({
      id: c.id,
      date: localDateOf(c.dueAt, client.timezone),
      status: c.reviewedAt
        ? ('reviewed' as const)
        : c.submittedAt
          ? ('sent' as const)
          : ('open' as const),
    }))
    .filter((c) => c.date >= gridStart && c.date <= gridEnd);

  return {
    month,
    gridStart,
    gridEnd,
    todayLocalDate: today,
    timezone: client.timezone,
    workouts,
    checkins,
    pause,
  };
}

/**
 * Moves one unstarted workout to another day (PRD C16), or, with `shiftLater`, that workout and every later
 * unstarted workout of the same program by the same number of days, keeping the sequence (one action for a
 * recurring series). Only `scheduled` workouts move; finished, started, missed and cancelled ones never do
 * (D-003 #5). Nothing moves into the past or while a pause is open (pauses shift sessions themselves, D-003 #4).
 */
export async function rescheduleSession(
  tx: TenantTx,
  actor: ActorContext,
  sessionId: string,
  input: { toLocalDate: string; shiftLater?: boolean },
  opts: { now?: Date; requestId?: string } = {},
): Promise<{ moved: number; deltaDays: number }> {
  assertCan(actor, 'assignment:write');
  if (!isUuid(sessionId)) throw notFound();
  const to = input.toLocalDate;
  if (typeof to !== 'string' || !DATE.test(to) || fromDbDate(toDbDate(to)) !== to) {
    throw invalid('toLocalDate', 'Use YYYY-MM-DD.');
  }
  const session = await tx.workoutSession.findFirst({
    where: { id: sessionId, state: { not: 'cancelled' } },
    select: {
      id: true,
      clientId: true,
      assignmentId: true,
      state: true,
      scheduledLocalDate: true,
      assignment: { select: { timezone: true } },
      client: { select: { timezone: true } },
    },
  });
  if (!session) throw notFound();
  if (session.state !== 'scheduled') {
    throw new DomainError('CONFLICT', 'Only workouts that have not been started can be moved.');
  }
  const open = await tx.clientPause.findFirst({
    where: { clientId: session.clientId, endedAt: null },
    select: { id: true },
  });
  if (open) {
    throw new DomainError('CONFLICT', 'Resume the program before moving workouts.');
  }
  const today = todayInZone(session.client.timezone, opts.now ?? new Date());
  const from = fromDbDate(session.scheduledLocalDate);
  if (from < today) {
    throw new DomainError('CONFLICT', 'This workout is already past its day.');
  }
  if (to < today) throw invalid('toLocalDate', 'Pick today or a later day.');
  if (daysBetween(today, to) > RESCHEDULE_MAX_DAYS_AHEAD) {
    throw invalid('toLocalDate', 'Pick a day within two years.');
  }
  const delta = daysBetween(from, to);
  if (delta === 0) return { moved: 0, deltaDays: 0 };

  const targets = input.shiftLater
    ? await tx.workoutSession.findMany({
        where: {
          assignmentId: session.assignmentId,
          state: 'scheduled',
          scheduledLocalDate: { gte: session.scheduledLocalDate },
        },
        select: { id: true, scheduledLocalDate: true },
      })
    : [{ id: session.id, scheduledLocalDate: session.scheduledLocalDate }];

  for (const t of targets) {
    const date = addDays(fromDbDate(t.scheduledLocalDate), delta);
    const { scheduledAtUtc, dueAtUtc } = localDayBounds(date, session.assignment.timezone);
    await tx.workoutSession.update({
      where: { id: t.id },
      data: { scheduledLocalDate: toDbDate(date), scheduledAt: scheduledAtUtc, dueAt: dueAtUtc },
    });
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'workout_session',
    objectId: session.id,
    action: 'session.rescheduled',
    metadata: { from, to, deltaDays: delta, moved: targets.length },
    requestId: opts.requestId,
  });
  return { moved: targets.length, deltaDays: delta };
}
