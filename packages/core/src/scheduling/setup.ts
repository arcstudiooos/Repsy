import { appendAudit, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { MANAGER_ROLES, TRAINER_ROLES } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { canonicalTimezone } from '../timezone';
import { isUuid } from '../uuid';

/**
 * PRD K10, H15 (D-013 #11): what a coach offers to book, when they're available, and their time off. A coach sets
 * their own; a manager may set any coach's in the workspace.
 */
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const notFound = () => new DomainError('NOT_FOUND', 'Not found.');

export type SessionKind = 'call' | 'checkin_call' | 'in_person';
export const SESSION_KINDS: readonly SessionKind[] = ['call', 'checkin_call', 'in_person'];

export interface SessionTypeView {
  id: string;
  coachUserId: string;
  coachName: string;
  title: string;
  kind: SessionKind;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  cancelWindowHours: number;
  callLink: string | null;
  location: string | null;
  usesCredit: boolean;
  active: boolean;
}

export const SESSION_TYPE_SELECT = {
  id: true,
  coachUserId: true,
  title: true,
  kind: true,
  durationMin: true,
  bufferBeforeMin: true,
  bufferAfterMin: true,
  minNoticeHours: true,
  maxDaysAhead: true,
  cancelWindowHours: true,
  callLink: true,
  location: true,
  usesCredit: true,
  active: true,
  coach: { select: { name: true } },
} as const;

type SessionTypeRow = Omit<SessionTypeView, 'coachName' | 'kind'> & {
  kind: string;
  coach: { name: string };
};

export const toSessionTypeView = (r: SessionTypeRow): SessionTypeView => ({
  id: r.id,
  coachUserId: r.coachUserId,
  coachName: r.coach.name,
  title: r.title,
  kind: r.kind as SessionKind,
  durationMin: r.durationMin,
  bufferBeforeMin: r.bufferBeforeMin,
  bufferAfterMin: r.bufferAfterMin,
  minNoticeHours: r.minNoticeHours,
  maxDaysAhead: r.maxDaysAhead,
  cancelWindowHours: r.cancelWindowHours,
  callLink: r.callLink,
  location: r.location,
  usesCredit: r.usesCredit,
  active: r.active,
});

/** The coach a schedule change is for: oneself, or (managers) another trainer in the workspace. */
export async function scheduleCoach(
  tx: TenantTx,
  actor: ActorContext,
  coachUserId: unknown,
): Promise<string> {
  assertCan(actor, 'schedule:manage');
  const target =
    coachUserId === undefined || coachUserId === null || coachUserId === ''
      ? actor.userId
      : coachUserId;
  if (typeof target !== 'string' || !isUuid(target)) throw invalid('coachUserId', 'Pick a coach.');
  if (target !== actor.userId && !(MANAGER_ROLES as readonly string[]).includes(actor.role)) {
    throw new DomainError('FORBIDDEN', 'You can only change your own schedule.');
  }
  const member = await tx.membership.findFirst({
    where: { userId: target, status: 'active', role: { in: [...TRAINER_ROLES] } },
    select: { id: true },
  });
  if (!member) throw invalid('coachUserId', 'Pick a coach in this workspace.');
  return target;
}

const intIn = (v: unknown, field: string, min: number, max: number, fallback?: number) => {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw invalid(field, `Enter a whole number from ${min} to ${max}.`);
  }
  return n;
};

/** H15: an https link with a host, nothing else (never javascript:, data: or http:). */
export function cleanCallLink(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > 500)
    throw invalid('callLink', 'Enter a link up to 500 characters.');
  let url: URL;
  try {
    url = new URL(v.trim());
  } catch {
    throw invalid('callLink', 'Enter a full link starting with https://');
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw invalid('callLink', 'Enter a full link starting with https://');
  }
  return url.toString();
}

export async function listSessionTypes(
  tx: TenantTx,
  actor: ActorContext,
  query: { coachUserId?: string; includeInactive?: boolean } = {},
): Promise<SessionTypeView[]> {
  let coach: string | undefined = query.coachUserId;
  if (actor.role === 'client') {
    assertCan(actor, 'schedule:book');
    // A client books with their own coach only.
    const me = await tx.client.findFirst({
      where: { id: actor.clientId ?? '' },
      select: { coachUserId: true },
    });
    if (!me) throw notFound();
    coach = me.coachUserId;
  } else {
    assertCan(actor, 'schedule:read');
    if (coach !== undefined && !isUuid(coach)) return [];
  }
  const rows = await tx.sessionType.findMany({
    where: {
      ...(coach ? { coachUserId: coach } : {}),
      ...(query.includeInactive && actor.role !== 'client' ? {} : { active: true }),
    },
    orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    select: SESSION_TYPE_SELECT,
  });
  return rows.map(toSessionTypeView);
}

export async function saveSessionType(
  tx: TenantTx,
  actor: ActorContext,
  input: Record<string, unknown> & { id?: unknown },
  opts: { requestId?: string } = {},
): Promise<SessionTypeView> {
  const existing =
    input.id !== undefined
      ? await tx.sessionType.findFirst({
          where: { id: isUuid(input.id) ? input.id : '00000000-0000-0000-0000-000000000000' },
          select: { coachUserId: true },
        })
      : null;
  if (input.id !== undefined && !existing) throw notFound();
  const coachUserId = await scheduleCoach(tx, actor, existing?.coachUserId ?? input.coachUserId);
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 1 || title.length > 80) throw invalid('title', 'Use 1-80 characters.');
  const kind = input.kind as SessionKind;
  if (!SESSION_KINDS.includes(kind)) throw invalid('kind', 'Pick a kind of session.');
  const location =
    typeof input.location === 'string' && input.location.trim() !== ''
      ? input.location.trim()
      : null;
  if (location && location.length > 200) throw invalid('location', 'Use up to 200 characters.');
  const callLink = kind === 'in_person' ? null : cleanCallLink(input.callLink);
  const data = {
    title,
    kind,
    durationMin: intIn(input.durationMin, 'durationMin', 10, 240),
    bufferBeforeMin: intIn(input.bufferBeforeMin, 'bufferBeforeMin', 0, 120, 0),
    bufferAfterMin: intIn(input.bufferAfterMin, 'bufferAfterMin', 0, 120, 0),
    minNoticeHours: intIn(input.minNoticeHours, 'minNoticeHours', 0, 336, 12),
    maxDaysAhead: intIn(input.maxDaysAhead, 'maxDaysAhead', 1, 180, 30),
    cancelWindowHours: intIn(input.cancelWindowHours, 'cancelWindowHours', 0, 168, 24),
    callLink,
    location: kind === 'in_person' ? location : null,
    usesCredit: input.usesCredit === true,
    active: input.active !== false,
  };
  let id: string;
  if (existing) {
    id = input.id as string;
    await tx.sessionType.updateMany({ where: { id }, data });
  } else {
    id = (
      await tx.sessionType.create({
        data: { ...data, coachUserId },
      } as Parameters<typeof tx.sessionType.create>[0])
    ).id;
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'session_type',
    objectId: id,
    action: existing ? 'session_type.updated' : 'session_type.created',
    requestId: opts.requestId,
  });
  return toSessionTypeView(
    await tx.sessionType.findFirstOrThrow({ where: { id }, select: SESSION_TYPE_SELECT }),
  );
}

// ---------------------------------------------------------------- availability and time off

export interface AvailabilityWindow {
  weekday: number;
  start: string;
  end: string;
}

export interface ScheduleView {
  coachUserId: string;
  timezone: string;
  windows: AvailabilityWindow[];
  timeOff: { id: string; startsAt: string; endsAt: string; note: string | null }[];
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function getSchedule(
  tx: TenantTx,
  actor: ActorContext,
  coachUserId?: string,
  now: Date = new Date(),
): Promise<ScheduleView> {
  assertCan(actor, 'schedule:read');
  const coach = coachUserId && isUuid(coachUserId) ? coachUserId : actor.userId;
  const [windows, timeOff, org] = await Promise.all([
    tx.coachAvailability.findMany({
      where: { coachUserId: coach },
      orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    }),
    tx.coachTimeOff.findMany({
      where: { coachUserId: coach, endsAt: { gt: now } },
      orderBy: { startsAt: 'asc' },
      take: 100,
    }),
    tx.organization.findFirstOrThrow({ select: { timezone: true } }),
  ]);
  return {
    coachUserId: coach,
    timezone: windows[0]?.timezone ?? org.timezone,
    windows: windows.map((w) => ({ weekday: w.weekday, start: w.startTime, end: w.endTime })),
    timeOff: timeOff.map((t) => ({
      id: t.id,
      startsAt: t.startsAt.toISOString(),
      endsAt: t.endsAt.toISOString(),
      note: t.note,
    })),
  };
}

/** Replaces a coach's weekly hours (at most 30 windows, non-overlapping per day). */
export async function setAvailability(
  tx: TenantTx,
  actor: ActorContext,
  input: { coachUserId?: unknown; timezone?: unknown; windows?: unknown },
  opts: { requestId?: string } = {},
): Promise<void> {
  const coach = await scheduleCoach(tx, actor, input.coachUserId);
  const timezone = canonicalTimezone(input.timezone);
  if (!timezone) throw invalid('timezone', 'Pick a time zone.');
  if (!Array.isArray(input.windows) || input.windows.length > 30) {
    throw invalid('windows', 'Add up to 30 time ranges.');
  }
  const windows = input.windows.map((w: unknown) => {
    const o = (w ?? {}) as Record<string, unknown>;
    const weekday = Number(o.weekday);
    const start = String(o.start ?? '');
    const end = String(o.end ?? '');
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      throw invalid('windows', 'Pick a day.');
    }
    if (!HHMM.test(start) || !(HHMM.test(end) || end === '24:00') || start >= end) {
      throw invalid('windows', 'Each range needs a start before its end.');
    }
    return { weekday, start, end };
  });
  const sorted = [...windows].sort(
    (a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start),
  );
  for (let i = 1; i < sorted.length; i++) {
    const [p, c] = [sorted[i - 1]!, sorted[i]!];
    if (p.weekday === c.weekday && c.start < p.end) {
      throw invalid('windows', 'Time ranges on the same day must not overlap.');
    }
  }
  await tx.coachAvailability.deleteMany({ where: { coachUserId: coach } });
  if (sorted.length) {
    await tx.coachAvailability.createMany({
      data: sorted.map((w) => ({
        coachUserId: coach,
        weekday: w.weekday,
        startTime: w.start,
        endTime: w.end,
        timezone,
      })),
    } as Parameters<typeof tx.coachAvailability.createMany>[0]);
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'availability',
    objectId: coach,
    action: 'availability.updated',
    metadata: { windows: sorted.length },
    requestId: opts.requestId,
  });
}

export async function addTimeOff(
  tx: TenantTx,
  actor: ActorContext,
  input: { coachUserId?: unknown; startsAt?: unknown; endsAt?: unknown; note?: unknown },
): Promise<{ id: string }> {
  const coach = await scheduleCoach(tx, actor, input.coachUserId);
  const startsAt = new Date(String(input.startsAt ?? ''));
  const endsAt = new Date(String(input.endsAt ?? ''));
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt >= endsAt) {
    throw invalid('endsAt', 'End after the start.');
  }
  if (endsAt.getTime() - startsAt.getTime() > 366 * 86_400_000) {
    throw invalid('endsAt', 'Up to a year at a time.');
  }
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim() : null;
  if (note && note.length > 200) throw invalid('note', 'Use up to 200 characters.');
  const row = await tx.coachTimeOff.create({
    data: { coachUserId: coach, startsAt, endsAt, note },
  } as Parameters<typeof tx.coachTimeOff.create>[0]);
  return { id: row.id };
}

export async function removeTimeOff(tx: TenantTx, actor: ActorContext, id: string): Promise<void> {
  if (!isUuid(id)) throw notFound();
  const row = await tx.coachTimeOff.findFirst({ where: { id }, select: { coachUserId: true } });
  if (!row) throw notFound();
  await scheduleCoach(tx, actor, row.coachUserId);
  await tx.coachTimeOff.deleteMany({ where: { id } });
}
