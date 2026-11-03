import { appendAudit, type SystemTx, type TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { MANAGER_ROLES } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { todayInZone, zonedTimeToUtc } from '../timezone';
import { isUuid } from '../uuid';
import { SESSION_TYPE_SELECT, toSessionTypeView, type SessionTypeView } from './setup';

/**
 * PRD K10, K11, H15 (D-013 #11, #12): open slots, bookings and session credits. Slots come from the coach's weekly
 * hours in their zone (DST-safe), less time off, other bookings (with buffers) and busy times from a connected
 * calendar. A booking takes the coach's membership row lock first, so two bookings for the same coach are decided one
 * after the other and can never overlap; a credit is taken from the oldest pack with credits left under its own row
 * lock.
 */
const DAY = 86_400_000;
const isManagerRole = (actor: ActorContext) =>
  (MANAGER_ROLES as readonly string[]).includes(actor.role);
const MIN = 60_000;
const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const conflict = (message: string) => new DomainError('CONFLICT', message);

type Interval = { from: number; to: number };
const overlaps = (a: Interval, b: Interval) => a.from < b.to && b.from < a.to;

const addLocalDays = (localDate: string, n: number) =>
  new Date(Date.parse(`${localDate}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const isoWeekday = (localDate: string) => {
  const d = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
};
const at = (localDate: string, hhmm: string, tz: string) =>
  hhmm === '24:00'
    ? zonedTimeToUtc(addLocalDays(localDate, 1), '00:00', tz)
    : zonedTimeToUtc(localDate, hhmm, tz);

/** Start-time granularity: a quarter hour for short sessions, half an hour for longer ones. */
const stepMin = (durationMin: number) => (durationMin <= 30 ? 15 : 30);

interface SlotContext {
  type: SessionTypeView;
  windows: { weekday: number; startTime: string; endTime: string; timezone: string }[];
  blocked: Interval[];
  busy: Interval[];
}

async function slotContext(
  tx: TenantTx,
  type: SessionTypeView,
  from: Date,
  to: Date,
  excludeBookingId?: string,
): Promise<SlotContext> {
  const [windows, timeOff, bookings, busy] = await Promise.all([
    tx.coachAvailability.findMany({
      where: { coachUserId: type.coachUserId },
      select: { weekday: true, startTime: true, endTime: true, timezone: true },
    }),
    tx.coachTimeOff.findMany({
      where: { coachUserId: type.coachUserId, startsAt: { lt: to }, endsAt: { gt: from } },
      select: { startsAt: true, endsAt: true },
    }),
    tx.booking.findMany({
      where: {
        coachUserId: type.coachUserId,
        status: 'booked',
        blockedFrom: { lt: to },
        blockedTo: { gt: from },
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
      select: { blockedFrom: true, blockedTo: true },
    }),
    tx.calendarBusy.findMany({
      where: { userId: type.coachUserId, startsAt: { lt: to }, endsAt: { gt: from } },
      select: { startsAt: true, endsAt: true },
    }),
  ]);
  return {
    type,
    windows,
    blocked: [
      ...timeOff.map((t) => ({ from: t.startsAt.getTime(), to: t.endsAt.getTime() })),
      ...bookings.map((b) => ({ from: b.blockedFrom.getTime(), to: b.blockedTo.getTime() })),
    ],
    busy: busy.map((b) => ({ from: b.startsAt.getTime(), to: b.endsAt.getTime() })),
  };
}

/** The open start times (UTC ms) for a session type between two instants. */
function openStarts(ctx: SlotContext, now: Date, from: Date, to: Date): number[] {
  const t = ctx.type;
  const earliest = Math.max(from.getTime(), now.getTime() + t.minNoticeHours * 3_600_000);
  const latest = Math.min(to.getTime(), now.getTime() + t.maxDaysAhead * DAY);
  if (earliest >= latest || ctx.windows.length === 0) return [];
  const tz = ctx.windows[0]!.timezone;
  const step = stepMin(t.durationMin) * MIN;
  const out = new Set<number>();
  // One extra day each side covers zone offsets.
  let day = addLocalDays(todayInZone(tz, new Date(earliest)), -1);
  const lastDay = addLocalDays(todayInZone(tz, new Date(latest)), 1);
  while (day <= lastDay) {
    const wd = isoWeekday(day);
    for (const w of ctx.windows) {
      if (w.weekday !== wd) continue;
      const ws = at(day, w.startTime, w.timezone)?.getTime();
      const we = at(day, w.endTime, w.timezone)?.getTime();
      if (ws === undefined || we === undefined) continue;
      for (let s = ws; s + t.durationMin * MIN <= we; s += step) {
        if (s < earliest || s > latest) continue;
        const session = { from: s, to: s + t.durationMin * MIN };
        const withBuffers = {
          from: s - t.bufferBeforeMin * MIN,
          to: session.to + t.bufferAfterMin * MIN,
        };
        if (ctx.blocked.some((b) => overlaps(b, withBuffers))) continue;
        if (ctx.busy.some((b) => overlaps(b, session))) continue;
        out.add(s);
      }
    }
    day = addLocalDays(day, 1);
  }
  return [...out].sort((a, b) => a - b);
}

async function bookableType(
  tx: TenantTx,
  actor: ActorContext,
  sessionTypeId: string,
  clientId: string,
): Promise<SessionTypeView> {
  if (!isUuid(sessionTypeId)) throw notFound();
  const row = await tx.sessionType.findFirst({
    where: { id: sessionTypeId, active: true },
    select: SESSION_TYPE_SELECT,
  });
  if (!row) throw notFound();
  const client = await tx.client.findFirst({
    where: { id: clientId, status: { in: ['active', 'invited', 'paused'] } },
    select: { coachUserId: true },
  });
  if (!client) throw notFound();
  // Clients book with their own coach; a coach books their own sessions for a client; managers any coach's
  // (security review S2).
  if (actor.role === 'client' && client.coachUserId !== row.coachUserId) throw notFound();
  if (actor.role !== 'client' && !isManagerRole(actor) && row.coachUserId !== actor.userId) {
    throw notFound();
  }
  // A coach who has left the workspace takes no bookings (security review S3).
  const active = await tx.membership.findFirst({
    where: { userId: row.coachUserId, status: 'active' },
    select: { id: true },
  });
  if (!active) throw notFound();
  return toSessionTypeView(row);
}

function clientFor(actor: ActorContext, clientId: unknown): string {
  if (actor.role === 'client') {
    assertCan(actor, 'schedule:book');
    if (!actor.clientId) throw notFound();
    return actor.clientId;
  }
  assertCan(actor, 'schedule:manage');
  if (typeof clientId !== 'string' || !isUuid(clientId)) throw notFound();
  return clientId;
}

/** Open slots, as ISO instants, for the next `days` days (at most 62). */
export async function listSlots(
  tx: TenantTx,
  actor: ActorContext,
  input: { sessionTypeId: string; clientId?: string; days?: number },
  now: Date = new Date(),
): Promise<{ sessionType: SessionTypeView; slots: string[] }> {
  const clientId = clientFor(actor, input.clientId);
  const type = await bookableType(tx, actor, input.sessionTypeId, clientId);
  const days = Math.min(62, Math.max(1, Math.floor(input.days ?? 14)));
  const from = now;
  const to = new Date(now.getTime() + days * DAY);
  const ctx = await slotContext(
    tx,
    type,
    new Date(from.getTime() - DAY),
    new Date(to.getTime() + DAY),
  );
  return {
    sessionType: type,
    slots: openStarts(ctx, now, from, to).map((s) => new Date(s).toISOString()),
  };
}

// ---------------------------------------------------------------- credits (K11)

export interface CreditBalance {
  left: number;
  /** The soonest expiry among packs with credits left. */
  nextExpiry: string | null;
}

export async function creditBalance(
  tx: TenantTx,
  actor: ActorContext,
  clientId?: string,
  now: Date = new Date(),
): Promise<CreditBalance> {
  const id = actor.role === 'client' ? clientFor(actor, undefined) : clientFor(actor, clientId);
  const packs = await tx.purchase.findMany({
    where: {
      clientId: id,
      creditsTotal: { not: null },
      status: { in: ['active', 'trialing', 'past_due', 'canceled', 'ended'] },
      OR: [{ creditsExpireAt: null }, { creditsExpireAt: { gt: now } }],
    },
    select: { creditsTotal: true, creditsUsed: true, creditsExpireAt: true },
  });
  let left = 0;
  let next: Date | null = null;
  for (const p of packs) {
    const l = (p.creditsTotal ?? 0) - p.creditsUsed;
    if (l <= 0) continue;
    left += l;
    if (p.creditsExpireAt && (!next || p.creditsExpireAt < next)) next = p.creditsExpireAt;
  }
  return { left, nextExpiry: next?.toISOString() ?? null };
}

/** Takes one credit from the oldest unexpired pack with credits left, atomically; null when there is none. */
async function takeCredit(tx: TenantTx, clientId: string, now: Date): Promise<string | null> {
  const raw = tx as unknown as Pick<SystemTx, '$queryRaw'>;
  // RLS still applies (same transaction and connection); FOR UPDATE SKIP LOCKED is not used: a concurrent booking
  // simply waits for this one and then sees the new count.
  const rows = await raw.$queryRaw<{ id: string }[]>`
    UPDATE purchases SET credits_used = credits_used + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM purchases
      WHERE client_id = ${clientId}::uuid
        AND credits_total IS NOT NULL AND credits_used < credits_total
        AND status IN ('active', 'trialing', 'past_due', 'canceled', 'ended')
        AND (credits_expire_at IS NULL OR credits_expire_at > ${now})
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------- bookings

export interface BookingView {
  id: string;
  sessionTypeId: string;
  coachUserId: string;
  coachName: string;
  clientId: string;
  clientName: string;
  title: string;
  kind: string;
  startsAt: string;
  endsAt: string;
  status: 'booked' | 'canceled' | 'completed' | 'no_show';
  callLink: string | null;
  location: string | null;
  usedCredit: boolean;
  creditReturned: boolean;
  /** Whether the viewer may still cancel it themselves. */
  cancellable: boolean;
}

const BOOKING_SELECT = {
  id: true,
  sessionTypeId: true,
  coachUserId: true,
  clientId: true,
  title: true,
  startsAt: true,
  endsAt: true,
  status: true,
  callLink: true,
  location: true,
  creditPurchaseId: true,
  creditReturned: true,
  coach: { select: { name: true } },
  client: { select: { name: true } },
  sessionType: { select: { kind: true, cancelWindowHours: true } },
} as const;

type BookingRow = {
  id: string;
  sessionTypeId: string;
  coachUserId: string;
  clientId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  callLink: string | null;
  location: string | null;
  creditPurchaseId: string | null;
  creditReturned: boolean;
  coach: { name: string };
  client: { name: string };
  sessionType: { kind: string; cancelWindowHours: number };
};

function toBookingView(r: BookingRow, actor: ActorContext, now: Date): BookingView {
  const live = r.status === 'booked' && r.startsAt > now;
  const inWindow =
    r.startsAt.getTime() - r.sessionType.cancelWindowHours * 3_600_000 >= now.getTime();
  return {
    id: r.id,
    sessionTypeId: r.sessionTypeId,
    coachUserId: r.coachUserId,
    coachName: r.coach.name,
    clientId: r.clientId,
    clientName: r.client.name,
    title: r.title,
    kind: r.sessionType.kind,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    status: r.status as BookingView['status'],
    callLink: r.callLink,
    location: r.location,
    usedCredit: r.creditPurchaseId !== null,
    creditReturned: r.creditReturned,
    cancellable: live && (actor.role !== 'client' || inWindow),
  };
}

/** Books a slot (the client for themselves, or staff for a client). */
export async function createBooking(
  tx: TenantTx,
  actor: ActorContext,
  input: { sessionTypeId?: unknown; startsAt?: unknown; clientId?: unknown },
  ctx: { now?: Date; requestId?: string } = {},
): Promise<BookingView> {
  const now = ctx.now ?? new Date();
  const clientId = clientFor(actor, input.clientId);
  const type = await bookableType(tx, actor, String(input.sessionTypeId ?? ''), clientId);
  const start = new Date(String(input.startsAt ?? ''));
  if (Number.isNaN(start.getTime())) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', { startsAt: ['Pick a time.'] });
  }
  // Serialise this coach's bookings: the second of two racing bookings waits here, then sees the first.
  const locked = await (tx as unknown as Pick<SystemTx, '$queryRaw'>).$queryRaw<{ id: string }[]>`
    SELECT id FROM memberships
    WHERE user_id = ${type.coachUserId}::uuid AND organization_id = app_current_org() AND status = 'active'
    FOR UPDATE`;
  // No row, no serialisation: refuse rather than book unlocked (security review S3).
  if (locked.length === 0) throw notFound();
  const slotCtx = await slotContext(
    tx,
    type,
    new Date(start.getTime() - DAY),
    new Date(start.getTime() + DAY),
  );
  const open = openStarts(
    slotCtx,
    now,
    new Date(start.getTime() - MIN),
    new Date(start.getTime() + MIN),
  );
  // Staff may book inside the notice period (they agreed it with the client); never over another booking.
  const free =
    open.includes(start.getTime()) ||
    (actor.role !== 'client' &&
      openStarts(
        { ...slotCtx, type: { ...type, minNoticeHours: 0, maxDaysAhead: 180 } },
        now,
        new Date(start.getTime() - MIN),
        new Date(start.getTime() + MIN),
      ).includes(start.getTime()));
  if (!free) throw conflict('That time was just taken or is no longer open. Pick another.');
  let creditPurchaseId: string | null = null;
  if (type.usesCredit) {
    // A second try covers the oldest pack running out while this booking waited on its row lock.
    creditPurchaseId =
      (await takeCredit(tx, clientId, now)) ?? (await takeCredit(tx, clientId, now));
    if (!creditPurchaseId) throw conflict('No session credits left. Buy a pack or ask your coach.');
  }
  const calendar = await tx.calendarConnection.findFirst({
    where: { userId: type.coachUserId, status: 'active' },
    select: { id: true },
  });
  const endsAt = new Date(start.getTime() + type.durationMin * MIN);
  const row = await tx.booking.create({
    data: {
      sessionTypeId: type.id,
      coachUserId: type.coachUserId,
      clientId,
      startsAt: start,
      endsAt,
      blockedFrom: new Date(start.getTime() - type.bufferBeforeMin * MIN),
      blockedTo: new Date(endsAt.getTime() + type.bufferAfterMin * MIN),
      title: type.title,
      callLink: type.callLink,
      location: type.location,
      creditPurchaseId,
      syncState: calendar ? 'pending' : 'none',
      createdBy: actor.userId,
    },
    select: BOOKING_SELECT,
  } as Parameters<typeof tx.booking.create>[0]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'booking',
    objectId: (row as { id: string }).id,
    action: 'booking.created',
    metadata: { byClient: actor.role === 'client', credit: creditPurchaseId !== null },
    requestId: ctx.requestId,
  });
  return toBookingView(row as unknown as BookingRow, actor, now);
}

/**
 * Cancels a booking. A client may cancel their own up to the session type's cancel window and gets their credit
 * back; staff may cancel any time and the credit always comes back (D-013 #12).
 */
export async function cancelBooking(
  tx: TenantTx,
  actor: ActorContext,
  bookingId: string,
  ctx: { now?: Date; requestId?: string } = {},
): Promise<BookingView> {
  const now = ctx.now ?? new Date();
  if (!isUuid(bookingId)) throw notFound();
  if (actor.role === 'client') assertCan(actor, 'schedule:book');
  else assertCan(actor, 'schedule:manage');
  const where = {
    id: bookingId,
    ...(actor.role === 'client' ? { clientId: actor.clientId ?? '' } : {}),
  };
  // Row lock, so a cancel and a reminder or second cancel can't interleave.
  await tx.booking.updateMany({ where, data: { updatedAt: now } });
  const b = (await tx.booking.findFirst({ where, select: BOOKING_SELECT })) as BookingRow | null;
  if (!b) throw notFound();
  // A coach cancels their own sessions; managers anyone's.
  if (actor.role !== 'client' && b.coachUserId !== actor.userId && !isManagerRole(actor)) {
    throw new DomainError('FORBIDDEN', 'You can only cancel your own sessions.');
  }
  if (b.status !== 'booked') throw conflict('This session is not booked any more.');
  if (b.startsAt <= now) throw conflict('This session has already started.');
  const inWindow =
    b.startsAt.getTime() - b.sessionType.cancelWindowHours * 3_600_000 >= now.getTime();
  if (actor.role === 'client' && !inWindow) {
    throw conflict('It is too late to cancel this session here. Message your coach.');
  }
  const returnCredit = b.creditPurchaseId !== null;
  if (returnCredit) {
    await tx.purchase.updateMany({
      where: { id: b.creditPurchaseId!, creditsUsed: { gt: 0 } },
      data: { creditsUsed: { decrement: 1 } },
    });
  }
  const sync = await tx.booking.findFirst({
    where: { id: b.id },
    select: { calendarEventRef: true, syncState: true },
  });
  await tx.booking.updateMany({
    where: { id: b.id },
    data: {
      status: 'canceled',
      canceledAt: now,
      canceledBy: actor.userId,
      creditReturned: returnCredit,
      ...(sync?.calendarEventRef || sync?.syncState === 'pending'
        ? { syncState: 'pending', syncAttempts: 0 }
        : {}),
    },
  });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'booking',
    objectId: b.id,
    action: 'booking.canceled',
    metadata: { byClient: actor.role === 'client', creditReturned: returnCredit },
    requestId: ctx.requestId,
  });
  return toBookingView(
    (await tx.booking.findFirstOrThrow({
      where: { id: b.id },
      select: BOOKING_SELECT,
    })) as BookingRow,
    actor,
    now,
  );
}

/** After the start, staff mark a session done or a no-show; a no-show keeps its credit used. */
export async function markBooking(
  tx: TenantTx,
  actor: ActorContext,
  bookingId: string,
  outcome: unknown,
  ctx: { now?: Date; requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'schedule:manage');
  const now = ctx.now ?? new Date();
  if (!isUuid(bookingId)) throw notFound();
  if (outcome !== 'completed' && outcome !== 'no_show') {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', { outcome: ['Pick one.'] });
  }
  // A coach marks their own sessions; managers anyone's (security review S1).
  const { count } = await tx.booking.updateMany({
    where: {
      id: bookingId,
      status: 'booked',
      startsAt: { lte: now },
      ...(isManagerRole(actor) ? {} : { coachUserId: actor.userId }),
    },
    data: { status: outcome },
  });
  if (count === 0) throw notFound();
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'booking',
    objectId: bookingId,
    action: `booking.${outcome}`,
    requestId: ctx.requestId,
  });
}

/** Bookings in a range: a client's own, a coach's (default: the viewer's) or one client's. */
export async function listBookings(
  tx: TenantTx,
  actor: ActorContext,
  query: {
    from?: Date;
    to?: Date;
    clientId?: string;
    coachUserId?: string;
    includeCanceled?: boolean;
  } = {},
  now: Date = new Date(),
): Promise<BookingView[]> {
  const where: Record<string, unknown> = {};
  if (actor.role === 'client') {
    where.clientId = clientFor(actor, undefined);
  } else {
    assertCan(actor, 'schedule:read');
    if (query.clientId !== undefined) {
      if (!isUuid(query.clientId)) return [];
      where.clientId = query.clientId;
    } else if (query.coachUserId !== undefined) {
      if (!isUuid(query.coachUserId)) return [];
      where.coachUserId = query.coachUserId;
    }
  }
  if (!query.includeCanceled) where.status = { not: 'canceled' };
  const from = query.from ?? new Date(now.getTime() - 7 * DAY);
  const to = query.to ?? new Date(now.getTime() + 90 * DAY);
  const rows = (await tx.booking.findMany({
    where: { ...where, startsAt: { gte: from, lt: to } },
    orderBy: { startsAt: 'asc' },
    take: 500,
    select: BOOKING_SELECT,
  })) as BookingRow[];
  return rows.map((r) => toBookingView(r, actor, now));
}
