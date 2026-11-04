import type { TenantTx } from '@kinetic/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { canonicalTimezone, todayInZone, zonedTimeToUtc } from '../timezone';
import { isUuid } from '../uuid';
import { consumePackCredit, refundPackCredit } from './packs';

/**
 * PRD K10 (scheduling) + H15 (call link) + K11 (pack debit on booking).
 *
 * Availability is weekly wall-clock windows in the coach's zone; slots are
 * generated in that zone and stored as UTC instants, so a DST change moves the
 * UTC instant but never the local time a client sees. Buffers keep bookings
 * apart: a candidate slot is free only when it does not overlap an existing
 * booking expanded by the session type's buffers. Reminders are outbox emails
 * whose `nextAttemptAt` is the reminder time (the worker sends outbox rows
 * once that time passes; verify that worker rule when merging — see
 * SLICE_REPORT_SCHEDULING.md).
 *
 * The Prisma client in this copy does not yet have `session_types` /
 * `bookings` (schema.prisma is untouched by this slice), so transactions run
 * through the structural `SchedulingDb` delegate below; after the parent
 * merges SCHEMA_SNIPPET_SCHEDULING.md and regenerates the client, replace the
 * delegate with the typed `tx.sessionType` / `tx.booking` calls.
 */
export const SESSION_TYPE_KINDS = ['call', 'checkin_call', 'in_person'] as const;
export type SessionTypeKind = (typeof SESSION_TYPE_KINDS)[number];

export interface AvailabilityWindow {
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** HH:MM wall-clock in the coach's zone. */
  startTime: string;
  endTime: string;
}

export interface Slot {
  start: Date;
  end: Date;
}

export interface SessionTypeView {
  id: string;
  coachUserId: string | null;
  name: string;
  kind: SessionTypeKind;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  reminderMinutesBefore: number;
  location: string | null;
  availability: AvailabilityWindow[];
  active: boolean;
}

export interface BookingView {
  id: string;
  sessionTypeId: string;
  clientId: string;
  coachUserId: string | null;
  startsAt: string;
  endsAt: string;
  status: 'booked' | 'cancelled' | 'completed';
  /** Zoom/Meet link (H15). Shown to coach and client; never anything else. */
  callLink: string | null;
  packId: string | null;
}

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * Pure (H15): a call link is either empty (null) or an http/https URL, at
 * most 2000 characters. Anything else — ftp, javascript:, a bare hostname —
 * is rejected so a booking can never carry a link that misleads a client.
 */
export function validateCallLink(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw invalid('callLink', 'Use a Zoom or Meet link.');
  const link = value.trim();
  if (link.length > 2000) throw invalid('callLink', 'That link is too long.');
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw invalid('callLink', 'Use a full Zoom or Meet link starting with https://.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalid('callLink', 'Use a full Zoom or Meet link starting with https://.');
  }
  return link;
}

function cleanTime(v: unknown, field: string): string {
  if (typeof v !== 'string' || !TIME.test(v)) throw invalid(field, 'Use a time like 09:00.');
  return v;
}

/** Pure: availability windows, validated and sorted. */
export function cleanAvailability(input: unknown): AvailabilityWindow[] {
  if (!Array.isArray(input)) throw invalid('availability', 'Add at least one available window.');
  if (input.length === 0 || input.length > 50) {
    throw invalid('availability', 'Add 1-50 available windows.');
  }
  const windows = input.map((raw, i) => {
    const w = (raw ?? {}) as Record<string, unknown>;
    const weekday = Number(w.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      throw invalid(`availability.${i}.weekday`, 'Use a weekday from 1 (Monday) to 7 (Sunday).');
    }
    const startTime = cleanTime(w.startTime, `availability.${i}.startTime`);
    const endTime = cleanTime(w.endTime, `availability.${i}.endTime`);
    if (endTime <= startTime) {
      throw invalid(`availability.${i}.endTime`, 'End after the start time.');
    }
    return { weekday, startTime, endTime };
  });
  return windows.sort((a, b) => a.weekday - b.weekday || (a.startTime < b.startTime ? -1 : 1));
}

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

function isoWeekday(date: string): number {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** Pure: do two half-open [start, end) spans overlap? Touching spans do not. */
export function spansOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Pure: generate bookable slots for `dateFrom..dateTo` (inclusive, YYYY-MM-DD)
 * in `timeZone`. Slots step by duration + bufferAfter, start on the window
 * start, and never cross the window end. A slot is dropped when it overlaps an
 * existing booking expanded by bufferBefore before it and bufferAfter after
 * it, so back-to-back bookings always keep their buffers. DST-safe: every
 * local wall time goes through `zonedTimeToUtc` (gap → after the jump, fold →
 * first occurrence), so a 09:00 slot stays 09:00 local across a clock change.
 */
export function generateSlots(input: {
  availability: AvailabilityWindow[];
  dateFrom: string;
  dateTo: string;
  timeZone: string;
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  existingBookings?: { startsAt: Date; endsAt: Date }[];
}): Slot[] {
  const zone = canonicalTimezone(input.timeZone);
  if (!zone) throw invalid('timeZone', 'Pick a valid time zone.');
  if (!DATE.test(input.dateFrom) || !DATE.test(input.dateTo) || input.dateTo < input.dateFrom) {
    throw invalid('dateFrom', 'Pick a valid date range.');
  }
  const duration = input.durationMinutes;
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
    throw invalid('durationMinutes', 'Use 5-480 minutes.');
  }
  const before = input.bufferBeforeMinutes ?? 0;
  const after = input.bufferAfterMinutes ?? 0;
  if (before < 0 || before > 120 || after < 0 || after > 120) {
    throw invalid('bufferMinutes', 'Use buffers of 0-120 minutes.');
  }
  const windows = cleanAvailability(input.availability);
  const slots: Slot[] = [];
  for (let date = input.dateFrom; date <= input.dateTo; date = addDays(date, 1)) {
    const weekday = isoWeekday(date);
    for (const w of windows.filter((x) => x.weekday === weekday)) {
      const step = duration + after;
      for (
        let start = minutesOf(w.startTime);
        start + duration <= minutesOf(w.endTime);
        start += step
      ) {
        const startUtc = zonedTimeToUtc(date, hhmm(start), zone);
        const endUtc = zonedTimeToUtc(date, hhmm(start + duration), zone);
        if (!startUtc || !endUtc) continue;
        const blocked = (input.existingBookings ?? []).some((b) =>
          spansOverlap(
            startUtc,
            endUtc,
            new Date(b.startsAt.getTime() - before * 60_000),
            new Date(b.endsAt.getTime() + after * 60_000),
          ),
        );
        if (!blocked) slots.push({ start: startUtc, end: endUtc });
      }
    }
  }
  return slots;
}

/**
 * Pure: whether [startsAt, endsAt) lies wholly inside one availability window on the local day it starts, in
 * `timeZone` (the coach's). DST-safe for the same reason as `generateSlots`: window edges go through
 * `zonedTimeToUtc` for that day.
 */
export function withinAvailability(
  startsAt: Date,
  endsAt: Date,
  availability: AvailabilityWindow[],
  timeZone: string,
): boolean {
  const zone = canonicalTimezone(timeZone);
  if (!zone) return false;
  const day = todayInZone(zone, startsAt);
  const weekday = isoWeekday(day);
  return availability.some((w) => {
    if (w.weekday !== weekday) return false;
    const open = zonedTimeToUtc(day, w.startTime, zone);
    const close = zonedTimeToUtc(day, w.endTime, zone);
    return open !== null && close !== null && open <= startsAt && endsAt <= close;
  });
}

/** Structural delegate for the not-yet-generated `session_types` / `bookings` models. */
interface SessionTypeRow {
  id: string;
  coachUserId: string | null;
  name: string;
  kind: SessionTypeKind;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  reminderMinutesBefore: number;
  location: string | null;
  availabilityJson: AvailabilityWindow[];
  active: boolean;
}

interface BookingRow {
  id: string;
  sessionTypeId: string;
  clientId: string;
  coachUserId: string | null;
  startsAt: Date | string;
  endsAt: Date | string;
  status: BookingView['status'];
  callLink: string | null;
  packId: string | null;
  packConsumed?: boolean;
}

export interface SchedulingDb {
  sessionType: {
    findFirst(args: unknown): Promise<SessionTypeRow | null>;
    findMany(args: unknown): Promise<SessionTypeRow[]>;
    create(args: unknown): Promise<{ id: string }>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  booking: {
    findFirst(args: unknown): Promise<BookingRow | null>;
    findMany(args: unknown): Promise<BookingRow[]>;
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
  };
  client: {
    findFirst(args: unknown): Promise<{ id: string; userId: string | null } | null>;
  };
  outboxEmail: {
    createMany(args: unknown): Promise<unknown>;
  };
}

const db = (tx: TenantTx): SchedulingDb => tx as unknown as SchedulingDb;

function toSessionTypeView(row: SessionTypeRow): SessionTypeView {
  return {
    id: row.id,
    coachUserId: row.coachUserId,
    name: row.name,
    kind: row.kind,
    durationMinutes: row.durationMinutes,
    bufferBeforeMinutes: row.bufferBeforeMinutes,
    bufferAfterMinutes: row.bufferAfterMinutes,
    reminderMinutesBefore: row.reminderMinutesBefore,
    location: row.location,
    availability: row.availabilityJson,
    active: row.active,
  };
}

function toBookingView(row: BookingRow): BookingView {
  return {
    id: row.id,
    sessionTypeId: row.sessionTypeId,
    clientId: row.clientId,
    coachUserId: row.coachUserId,
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: new Date(row.endsAt).toISOString(),
    status: row.status,
    callLink: row.callLink,
    packId: row.packId,
  };
}

/** A coach (or manager) creates or updates a bookable session type. */
export async function saveSessionType(
  tx: TenantTx,
  actor: ActorContext,
  input: Record<string, unknown>,
): Promise<{ id: string }> {
  assertCan(actor, 'client:update');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 1 || name.length > 120) throw invalid('name', 'Use 1-120 characters.');
  if (!(SESSION_TYPE_KINDS as readonly unknown[]).includes(input.kind)) {
    throw invalid('kind', 'Pick call, check-in call, or in-person.');
  }
  const duration = Number(input.durationMinutes);
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
    throw invalid('durationMinutes', 'Use 5-480 minutes.');
  }
  const buffer = (v: unknown, field: string) => {
    const n = v === undefined ? 0 : Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 120) throw invalid(field, 'Use 0-120 minutes.');
    return n;
  };
  const reminder =
    input.reminderMinutesBefore === undefined ? 60 : Number(input.reminderMinutesBefore);
  if (!Number.isInteger(reminder) || reminder < 15 || reminder > 1440) {
    throw invalid('reminderMinutesBefore', 'Use 15-1440 minutes.');
  }
  const location =
    typeof input.location === 'string' && input.location.trim() !== ''
      ? input.location.trim().slice(0, 500)
      : null;
  if (input.kind === 'in_person' && !location) {
    throw invalid('location', 'Add where the in-person session happens.');
  }
  const availability = cleanAvailability(input.availability);
  // On update the coach stays the original owner; only creates set it.
  const data = {
    ...(input.id === undefined ? { coachUserId: actor.userId } : {}),
    name,
    kind: input.kind as string,
    durationMinutes: duration,
    bufferBeforeMinutes: buffer(input.bufferBeforeMinutes, 'bufferBeforeMinutes'),
    bufferAfterMinutes: buffer(input.bufferAfterMinutes, 'bufferAfterMinutes'),
    reminderMinutesBefore: reminder,
    location,
    availabilityJson: availability,
    active: input.active !== false,
  };
  if (input.id !== undefined) {
    if (!isUuid(input.id)) throw notFound();
    const { count } = await db(tx).sessionType.updateMany({
      where: { id: input.id },
      data,
    });
    if (count === 0) throw notFound();
    return { id: input.id as string };
  }
  const row = await db(tx).sessionType.create({ data, select: { id: true } });
  return { id: row.id };
}

/** Bookable session types for the workspace (active first, then by name). Clients see them to book. */
export async function listSessionTypes(
  tx: TenantTx,
  actor: ActorContext,
): Promise<SessionTypeView[]> {
  assertCan(actor, 'session:read');
  const rows = await db(tx).sessionType.findMany({
    where: { active: true },
    orderBy: [{ name: 'asc' }],
    select: {
      id: true,
      coachUserId: true,
      name: true,
      kind: true,
      durationMinutes: true,
      bufferBeforeMinutes: true,
      bufferAfterMinutes: true,
      reminderMinutesBefore: true,
      location: true,
      availabilityJson: true,
      active: true,
    },
  });
  return rows.map(toSessionTypeView);
}

async function assertBookingActor(actor: ActorContext, clientId: string): Promise<void> {
  if (actor.role === 'client') {
    assertCan(actor, 'session:log');
    if (actor.clientId !== clientId) {
      throw new DomainError('FORBIDDEN', 'You do not have access to this.');
    }
  } else {
    assertCan(actor, 'client:update');
  }
}

/**
 * Books a slot. Overlap is checked against the same coach's booked bookings
 * expanded by the type's buffers. An in-person booking with a packId spends
 * one pack credit (K11); cancelling refunds it. A reminder email is queued in
 * the outbox for `reminderMinutesBefore` before the start, addressed to the
 * client's account when they have one.
 */
export async function createBooking(
  tx: TenantTx,
  actor: ActorContext,
  input: Record<string, unknown>,
  opts: { now?: Date } = {},
): Promise<{ id: string }> {
  const now = opts.now ?? new Date();
  if (!isUuid(input.sessionTypeId) || !isUuid(input.clientId)) throw notFound();
  await assertBookingActor(actor, input.clientId as string);
  const type = await db(tx).sessionType.findFirst({
    where: { id: input.sessionTypeId, active: true },
    select: {
      id: true,
      coachUserId: true,
      name: true,
      kind: true,
      durationMinutes: true,
      bufferBeforeMinutes: true,
      bufferAfterMinutes: true,
      reminderMinutesBefore: true,
      location: true,
      availabilityJson: true,
      active: true,
    },
  });
  if (!type) throw notFound();
  const client = await db(tx).client.findFirst({
    where: { id: input.clientId },
    select: { id: true, userId: true },
  });
  if (!client) throw notFound();
  const startsAt = new Date(input.startsAt as string);
  const endsAt = new Date(input.endsAt as string);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw invalid('startsAt', 'Pick a valid start and end.');
  }
  if (startsAt <= now) throw invalid('startsAt', 'Book a future slot.');
  if (endsAt.getTime() - startsAt.getTime() !== type.durationMinutes * 60_000) {
    throw invalid('endsAt', `This session type lasts ${type.durationMinutes} minutes.`);
  }
  const callLink = validateCallLink(input.callLink);
  if (type.kind === 'call' || type.kind === 'checkin_call') {
    // A call link is optional at booking time (the coach may add it later by
    // re-booking), but when present it must be a valid http/https URL.
  }
  // Only inside the coach's weekly availability, read in the workspace's zone (the coach's zone).
  const org = await tx.organization.findFirstOrThrow({ select: { timezone: true } });
  if (!withinAvailability(startsAt, endsAt, type.availabilityJson ?? [], org.timezone)) {
    throw invalid('startsAt', 'That time is outside the available hours for this session.');
  }
  // Serialize bookings for one coach: no raw SQL in TenantTx, so a no-op UPDATE of the coach's active session
  // types takes their row locks until the transaction ends. A second booking for this coach waits here, then sees
  // the first one in the clash check below instead of both inserting.
  await db(tx).sessionType.updateMany({
    where: { coachUserId: type.coachUserId, active: true },
    data: { active: true },
  });
  const clashes = await db(tx).booking.findMany({
    where: {
      coachUserId: type.coachUserId,
      status: 'booked',
      startsAt: { lt: new Date(endsAt.getTime() + type.bufferAfterMinutes * 60_000) },
      endsAt: { gt: new Date(startsAt.getTime() - type.bufferBeforeMinutes * 60_000) },
    },
    select: { id: true },
  });
  if (clashes.length > 0) {
    throw new DomainError('CONFLICT', 'That slot is no longer free (buffers included).');
  }
  let packId: string | null = null;
  let packConsumed = false;
  if (input.packId !== undefined && input.packId !== null && input.packId !== '') {
    if (!isUuid(input.packId)) throw invalid('packId', 'Pick a valid session pack.');
    if (type.kind !== 'in_person') {
      throw invalid('packId', 'Packs pay for in-person sessions only.');
    }
    await consumePackCredit(tx, input.packId as string, client.id, { now });
    packId = input.packId as string;
    packConsumed = true;
  }
  const row = await db(tx).booking.create({
    data: {
      sessionTypeId: type.id,
      clientId: client.id,
      coachUserId: type.coachUserId,
      startsAt,
      endsAt,
      status: 'booked',
      callLink,
      packId,
      packConsumed,
    },
    select: { id: true },
  });
  if (client.userId) {
    const remindAt = new Date(startsAt.getTime() - type.reminderMinutesBefore * 60_000);
    await db(tx).outboxEmail.createMany({
      data: [
        {
          kind: 'booking_reminder',
          toUserId: client.userId,
          templateKey: 'booking_reminder',
          payloadJson: { bookingId: row.id, sessionTypeName: type.name },
          idempotencyKey: `booking-reminder:${row.id}`,
          nextAttemptAt: remindAt > now ? remindAt : now,
        },
      ],
      skipDuplicates: true,
    });
  }
  return { id: row.id };
}

/** Cancels a booking. A pack credit spent on it is refunded (K11). Past bookings cannot be cancelled. */
export async function cancelBooking(
  tx: TenantTx,
  actor: ActorContext,
  bookingId: string,
  opts: { now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  if (!isUuid(bookingId)) throw notFound();
  const booking = await db(tx).booking.findFirst({
    where: { id: bookingId },
    select: {
      id: true,
      clientId: true,
      startsAt: true,
      status: true,
      packId: true,
      packConsumed: true,
    },
  });
  if (!booking) throw notFound();
  await assertBookingActor(actor, booking.clientId);
  if (booking.status !== 'booked')
    throw new DomainError('CONFLICT', 'That booking is already settled.');
  if (new Date(booking.startsAt) <= now) {
    throw new DomainError('CONFLICT', 'A booking that has started cannot be cancelled.');
  }
  if (booking.packConsumed && booking.packId) {
    await refundPackCredit(tx, booking.packId, booking.clientId);
  }
  await db(tx).booking.update({
    where: { id: booking.id },
    data: { status: 'cancelled', packConsumed: false, cancelledAt: now },
  });
}

/** Bookings for one client, soonest first. Clients see only their own. */
export async function listBookings(
  tx: TenantTx,
  actor: ActorContext,
  clientId: string,
): Promise<BookingView[]> {
  assertCan(actor, 'session:read');
  if (actor.role === 'client' && actor.clientId !== clientId) {
    throw new DomainError('FORBIDDEN', 'You do not have access to this.');
  }
  if (!isUuid(clientId)) throw notFound();
  const rows = await db(tx).booking.findMany({
    where: { clientId },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      sessionTypeId: true,
      clientId: true,
      coachUserId: true,
      startsAt: true,
      endsAt: true,
      status: true,
      callLink: true,
      packId: true,
    },
  });
  return rows.map(toBookingView);
}
