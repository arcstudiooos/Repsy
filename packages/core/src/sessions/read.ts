import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { PAGE_SIZE } from '../pagination';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';
import { OPEN_STATES, PAST_STATES, type SessionState, type SessionSummary } from './types';

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

export const toDbDate = (localDate: string): Date => new Date(`${localDate}T00:00:00.000Z`);
export const fromDbDate = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The session filter an actor may see. A client only ever reaches their own sessions (`actor.clientId`, set
 * server-side from their Client row); a client actor without one sees nothing. Coaches see their org (RLS).
 */
export function sessionScope(actor: ActorContext): { clientId?: string } {
  if (actor.role !== 'client') return {};
  if (!actor.clientId) throw notFound();
  return { clientId: actor.clientId };
}

/** Columns every summary needs. */
export const SUMMARY_SELECT = {
  id: true,
  clientId: true,
  assignmentId: true,
  slotWeekIndex: true,
  slotDayIndex: true,
  kind: true,
  readinessScore: true,
  scheduledLocalDate: true,
  dueAt: true,
  state: true,
  workoutVersionId: true,
  loggedByUserId: true,
  startedAt: true,
  completedAt: true,
} as const;

export interface SummaryRow {
  id: string;
  clientId: string;
  /** Null, with the slot, for an extra workout (PRD D13): its version is fixed from the start. */
  assignmentId: string | null;
  slotWeekIndex: number | null;
  slotDayIndex: number | null;
  kind: string;
  readinessScore: number | null;
  scheduledLocalDate: Date;
  dueAt: Date;
  state: SessionState;
  workoutVersionId: string | null;
  loggedByUserId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * Titles and exercise counts for many sessions in three queries: locked versions directly, unstarted sessions
 * through their assignment program's current version slot (D-002 #5).
 */
export async function summarize(
  tx: TenantTx,
  rows: SummaryRow[],
  now: Date,
): Promise<SessionSummary[]> {
  const assignmentIds = [
    ...new Set(
      rows.flatMap((r) => (!r.workoutVersionId && r.assignmentId ? [r.assignmentId] : [])),
    ),
  ];
  const assignments = assignmentIds.length
    ? await tx.programAssignment.findMany({
        where: { id: { in: assignmentIds } },
        select: { id: true, program: { select: { currentVersionId: true } } },
      })
    : [];
  const currentVersion = new Map(assignments.map((a) => [a.id, a.program.currentVersionId]));

  const slotKeys = rows.flatMap((r) => {
    const programVersionId =
      r.workoutVersionId || !r.assignmentId ? null : currentVersion.get(r.assignmentId);
    return programVersionId && r.slotWeekIndex !== null && r.slotDayIndex !== null
      ? [{ programVersionId, weekIndex: r.slotWeekIndex, dayIndex: r.slotDayIndex }]
      : [];
  });
  const slots = slotKeys.length
    ? await tx.programSlot.findMany({
        where: { OR: slotKeys },
        select: { programVersionId: true, weekIndex: true, dayIndex: true, workoutVersionId: true },
      })
    : [];
  const slotKey = (v: string, w: number, d: number) => `${v}:${w}:${d}`;
  const slotVersion = new Map(
    slots.map((s) => [slotKey(s.programVersionId, s.weekIndex, s.dayIndex), s.workoutVersionId]),
  );

  const versionOf = (r: SummaryRow): string | undefined => {
    if (r.workoutVersionId) return r.workoutVersionId;
    const pv = r.assignmentId ? currentVersion.get(r.assignmentId) : undefined;
    return pv && r.slotWeekIndex !== null && r.slotDayIndex !== null
      ? slotVersion.get(slotKey(pv, r.slotWeekIndex, r.slotDayIndex))
      : undefined;
  };
  const versionIds = [...new Set(rows.map(versionOf).filter((v): v is string => !!v))];
  const versions = versionIds.length
    ? await tx.workoutVersion.findMany({
        where: { id: { in: versionIds } },
        select: { id: true, title: true, _count: { select: { exercises: true } } },
      })
    : [];
  const byId = new Map(versions.map((v) => [v.id, v]));

  return rows.map((r) => {
    const wv = byId.get(versionOf(r) ?? '');
    const open = r.state === 'scheduled' || r.state === 'in_progress';
    return {
      id: r.id,
      clientId: r.clientId,
      scheduledLocalDate: fromDbDate(r.scheduledLocalDate),
      dueAt: r.dueAt.toISOString(),
      state: r.state,
      title: wv?.title ?? 'Workout',
      exerciseCount: wv?._count.exercises ?? 0,
      loggedByCoach: r.loggedByUserId !== null,
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      overdue: open && r.dueAt < now,
      extra: r.kind === 'extra',
      readinessScore: r.readinessScore,
    };
  });
}

/** Opaque keyset cursor over `(dueAt, id)`. */
export function encodeSessionCursor(row: { dueAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ d: row.dueAt.toISOString(), i: row.id })).toString(
    'base64url',
  );
}

export function decodeSessionCursor(cursor: string): { dueAt: Date; id: string } {
  const invalid = () => new DomainError('VALIDATION', 'Invalid cursor.', { cursor: ['Invalid.'] });
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (parsed === null || typeof parsed !== 'object') throw invalid();
  const { d, i } = parsed as { d?: unknown; i?: unknown };
  if (typeof d !== 'string' || typeof i !== 'string' || !isUuid(i)) throw invalid();
  const dueAt = new Date(d);
  if (Number.isNaN(dueAt.getTime()) || dueAt.toISOString() !== d) throw invalid();
  return { dueAt, id: i };
}

export type SessionListScope = 'upcoming' | 'past';

/**
 * A client's sessions (S2-1): `upcoming` = scheduled + in progress, oldest due first; `past` = finished, newest
 * first. Cancelled sessions never appear. Deliberately no filter on the assignment's status: an ended assignment
 * keeps its scheduled sessions dated before the replacement's start (D-010 #2), and those are still to do.
 * A client actor always gets their own sessions (any `clientId` input is ignored); a coach names the client.
 */
export async function listSessions(
  tx: TenantTx,
  actor: ActorContext,
  query: { clientId?: string; scope: SessionListScope; cursor?: string },
  opts: { now?: Date } = {},
): Promise<{ items: SessionSummary[]; nextCursor: string | null }> {
  assertCan(actor, 'session:read');
  const now = opts.now ?? new Date();
  let clientId: string;
  if (actor.role === 'client') {
    clientId = sessionScope(actor).clientId as string;
  } else {
    if (!isUuid(query.clientId)) throw notFound();
    const client = await tx.client.findFirst({
      where: { id: query.clientId },
      select: { id: true },
    });
    if (!client) throw notFound();
    clientId = client.id;
  }

  const upcoming = query.scope === 'upcoming';
  const and: Record<string, unknown>[] = [
    { clientId, state: { in: upcoming ? [...OPEN_STATES] : [...PAST_STATES] } },
  ];
  if (query.cursor !== undefined) {
    const c = decodeSessionCursor(query.cursor);
    const beyond = upcoming ? 'gt' : 'lt';
    and.push({
      OR: [{ dueAt: { [beyond]: c.dueAt } }, { dueAt: c.dueAt, id: { [beyond]: c.id } }],
    });
  }
  const dir = upcoming ? 'asc' : 'desc';
  const rows = await tx.workoutSession.findMany({
    where: { AND: and },
    orderBy: [{ dueAt: dir }, { id: dir }],
    take: PAGE_SIZE + 1,
    select: SUMMARY_SELECT,
  });
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: await summarize(tx, page, now),
    nextCursor: rows.length > PAGE_SIZE && last ? encodeSessionCursor(last) : null,
  };
}

/** Monday and Sunday (YYYY-MM-DD) of the ISO week containing `localDate`. Pure calendar arithmetic. */
export function isoWeekOf(localDate: string): { start: string; end: string } {
  const d = toDbDate(localDate);
  const isoDay = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const start = new Date(d.getTime() - (isoDay - 1) * 86_400_000);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return { start: fromDbDate(start), end: fromDbDate(end) };
}

export interface PortalHome {
  nextWorkout: SessionSummary | null;
  /** This ISO week (Mon–Sun) in the client's time zone. `total` excludes cancelled sessions. */
  week: { completed: number; total: number; startLocalDate: string; endLocalDate: string };
  /** D-007 #5: shown until the client's first workout is started, completed or skipped. */
  showSafetyReminder: boolean;
  hasAssignment: boolean;
  /** Today in the client's time zone (YYYY-MM-DD), for date labels. */
  todayLocalDate: string;
  /** The open pause of the client's program (S3-5), for the "Program paused" banner. */
  pause: { startLocalDate: string; resumeLocalDate: string } | null;
  /** The newest check-in not yet sent (S4-1), for the portal home card. */
  openCheckin: { id: string; title: string; dueAt: string } | null;
  /** PRD D4: the workouts of the next 7 days (today included), kept on the device so they can start offline. */
  upcomingSessionIds: string[];
}

/** PRD D4: how many days ahead of today the device keeps workouts. */
export const OFFLINE_DAYS = 7;

/** The portal home for the acting client (S2-1). */
export async function getPortalHome(
  tx: TenantTx,
  actor: ActorContext,
  opts: { now?: Date } = {},
): Promise<PortalHome> {
  assertCan(actor, 'session:read');
  if (actor.role !== 'client') {
    throw new DomainError('FORBIDDEN', 'You do not have access to this.');
  }
  const { clientId } = sessionScope(actor);
  const now = opts.now ?? new Date();
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { id: true, timezone: true },
  });
  if (!client) throw notFound();

  const order = [{ dueAt: 'asc' as const }, { id: 'asc' as const }];
  const next =
    (await tx.workoutSession.findFirst({
      where: { clientId: client.id, state: 'in_progress' },
      orderBy: order,
      select: SUMMARY_SELECT,
    })) ??
    // Started in the last day and swept to incomplete (training across midnight, low grace): still continued here
    // (PR #2 review B-I3). Older ones are history, finished from the workouts list.
    (await tx.workoutSession.findFirst({
      where: {
        clientId: client.id,
        state: 'incomplete',
        startedAt: { gte: new Date(now.getTime() - 24 * 3_600_000) },
      },
      orderBy: order,
      select: SUMMARY_SELECT,
    })) ??
    (await tx.workoutSession.findFirst({
      where: { clientId: client.id, state: 'scheduled', dueAt: { gte: now } },
      orderBy: order,
      select: SUMMARY_SELECT,
    }));

  const today = todayInZone(client.timezone, now);
  const { start, end } = isoWeekOf(today);
  const weekWhere = {
    clientId: client.id,
    kind: 'planned',
    scheduledLocalDate: { gte: toDbDate(start), lte: toDbDate(end) },
  };
  // Sequential: one interactive transaction runs one statement at a time.
  const total = await tx.workoutSession.count({
    where: { ...weekWhere, state: { not: 'cancelled' } },
  });
  const completed = await tx.workoutSession.count({ where: { ...weekWhere, state: 'completed' } });
  const begun = await tx.workoutSession.count({
    where: {
      clientId: client.id,
      OR: [{ startedAt: { not: null } }, { state: { in: ['completed', 'skipped'] } }],
    },
  });
  const assignments = await tx.programAssignment.count({ where: { clientId: client.id } });
  const checkin = await tx.checkin.findFirst({
    where: { clientId: client.id, submittedAt: null },
    orderBy: { periodLocalDate: 'desc' },
    select: { id: true, dueAt: true, template: { select: { title: true } } },
  });
  const upcoming = await tx.workoutSession.findMany({
    where: {
      clientId: client.id,
      kind: 'planned',
      state: 'scheduled',
      scheduledLocalDate: {
        gte: toDbDate(today),
        lt: new Date(toDbDate(today).getTime() + OFFLINE_DAYS * 86_400_000),
      },
    },
    orderBy: order,
    take: 14,
    select: { id: true },
  });
  const pause = await tx.clientPause.findFirst({
    where: { clientId: client.id, endedAt: null },
    select: { startLocalDate: true, resumeLocalDate: true },
  });

  return {
    nextWorkout: next ? ((await summarize(tx, [next], now))[0] ?? null) : null,
    week: { completed, total, startLocalDate: start, endLocalDate: end },
    showSafetyReminder: begun === 0,
    hasAssignment: assignments > 0,
    todayLocalDate: today,
    pause: pause
      ? {
          startLocalDate: fromDbDate(pause.startLocalDate),
          resumeLocalDate: fromDbDate(pause.resumeLocalDate),
        }
      : null,
    openCheckin: checkin
      ? { id: checkin.id, title: checkin.template.title, dueAt: checkin.dueAt.toISOString() }
      : null,
    upcomingSessionIds: upcoming.map((s) => s.id),
  };
}
