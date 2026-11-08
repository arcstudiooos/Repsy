import { randomUUID } from 'node:crypto';
import type { TenantTx } from '@repsy/db';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isUuid } from '../uuid';

/**
 * PRD K12: group classes. A trainer schedules a class (optionally repeating weekly), with a capacity.
 * Clients book a place; when it is full they join the waitlist, and the first person waiting moves
 * up when someone cancels. Trainers mark attendance after the class.
 */
export const MAX_CLASS_REPEATS = 26;

export interface ClassView {
  id: string;
  seriesId: string;
  title: string;
  description: string | null;
  locationId: string | null;
  locationName: string | null;
  coachName: string | null;
  startsAt: string;
  endsAt: string;
  capacity: number;
  booked: number;
  waitlisted: number;
  cancelled: boolean;
  /** The calling client's place, when the actor is a client. */
  myStatus: 'booked' | 'waitlisted' | null;
}

export interface RosterEntry {
  enrollmentId: string;
  clientId: string;
  clientName: string;
  status: 'booked' | 'waitlisted';
  attended: boolean | null;
}

const notFound = () => new DomainError('NOT_FOUND', 'Class not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

/** Schedules a class, repeated weekly `repeatWeeks` times (1 = just this one). Trainers. */
export async function createClassSeries(
  tx: TenantTx,
  actor: ActorContext,
  input: {
    title: string;
    description?: string | null;
    startsAt: string;
    durationMinutes: number;
    capacity: number;
    repeatWeeks?: number;
    locationId?: string | null;
    coachUserId?: string | null;
  },
  opts: { now?: Date } = {},
): Promise<{ seriesId: string; created: number }> {
  assertCan(actor, 'class:manage');
  const now = opts.now ?? new Date();
  const title = input.title.trim();
  if (!title || title.length > 120) throw invalid('title', 'Use 1-120 characters.');
  const description = input.description?.trim() || null;
  if (description && description.length > 2000) {
    throw invalid('description', 'Use up to 2000 characters.');
  }
  const start = new Date(input.startsAt);
  if (Number.isNaN(start.getTime()) || start <= now) {
    throw invalid('startsAt', 'Pick a future start time.');
  }
  const minutes = input.durationMinutes;
  if (!Number.isInteger(minutes) || minutes < 10 || minutes > 480) {
    throw invalid('durationMinutes', 'Use 10-480 minutes.');
  }
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 500) {
    throw invalid('capacity', 'Use 1-500 places.');
  }
  const repeats = input.repeatWeeks ?? 1;
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > MAX_CLASS_REPEATS) {
    throw invalid('repeatWeeks', `Repeat 1-${MAX_CLASS_REPEATS} weeks.`);
  }
  const locationId = input.locationId || null;
  if (locationId) {
    const ok =
      isUuid(locationId) &&
      (await tx.location.findFirst({
        where: { id: locationId, organizationId: actor.orgId, archivedAt: null },
        select: { id: true },
      }));
    if (!ok) throw invalid('locationId', 'Pick a location.');
  }
  const coachUserId = input.coachUserId || actor.userId;
  if (coachUserId !== actor.userId) {
    const staff =
      isUuid(coachUserId) &&
      (await tx.membership.findFirst({
        where: {
          userId: coachUserId,
          organizationId: actor.orgId,
          status: 'active',
          role: { in: ['owner', 'admin', 'coach'] },
        },
        select: { id: true },
      }));
    if (!staff) throw invalid('coachUserId', 'Pick a coach from your team.');
  }
  const seriesId = randomUUID();
  const week = 7 * 86_400_000;
  // Weekly repeats keep the same UTC instant; the class page shows each in the viewer's zone.
  await tx.groupClass.createMany({
    data: Array.from({ length: repeats }, (_, i) => {
      const startsAt = new Date(start.getTime() + i * week);
      return {
        organizationId: actor.orgId,
        seriesId,
        title,
        description,
        locationId,
        coachUserId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + minutes * 60_000),
        capacity: input.capacity,
      };
    }),
  });
  return { seriesId, created: repeats };
}

/** Classes in [from, to), soonest first, with counts and (for clients) their own place. */
export async function listClasses(
  tx: TenantTx,
  actor: ActorContext,
  range: { from: Date; to: Date; locationId?: string | null },
): Promise<ClassView[]> {
  assertCan(actor, 'class:read');
  const rows = await tx.groupClass.findMany({
    where: {
      organizationId: actor.orgId,
      startsAt: { gte: range.from, lt: range.to },
      ...(range.locationId ? { locationId: range.locationId } : {}),
      ...(actor.role === 'client' ? { cancelledAt: null } : {}),
    },
    orderBy: { startsAt: 'asc' },
    take: 300,
    select: {
      id: true,
      seriesId: true,
      title: true,
      description: true,
      locationId: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      cancelledAt: true,
      location: { select: { name: true } },
      coach: { select: { name: true } },
      enrollments: {
        where: { status: { in: ['booked', 'waitlisted'] } },
        select: { status: true, clientId: true },
      },
    },
  });
  return rows.map((r) => {
    const mine = r.enrollments.find((e) => actor.clientId && e.clientId === actor.clientId);
    return {
      id: r.id,
      seriesId: r.seriesId,
      title: r.title,
      description: r.description,
      locationId: r.locationId,
      locationName: r.location?.name ?? null,
      coachName: r.coach?.name ?? null,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      capacity: r.capacity,
      booked: r.enrollments.filter((e) => e.status === 'booked').length,
      waitlisted: r.enrollments.filter((e) => e.status === 'waitlisted').length,
      cancelled: r.cancelledAt !== null,
      myStatus: mine ? (mine.status as 'booked' | 'waitlisted') : null,
    };
  });
}

/** Booked first, then the waitlist in the order people joined. Staff only. */
export async function classRoster(
  tx: TenantTx,
  actor: ActorContext,
  classId: string,
): Promise<RosterEntry[]> {
  assertCan(actor, 'class:manage');
  if (!isUuid(classId)) throw notFound();
  const found = await tx.groupClass.findFirst({
    where: { id: classId, organizationId: actor.orgId },
    select: { id: true },
  });
  if (!found) throw notFound();
  const rows = await tx.classEnrollment.findMany({
    where: { classId, status: { in: ['booked', 'waitlisted'] } },
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      clientId: true,
      status: true,
      attended: true,
      client: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    enrollmentId: r.id,
    clientId: r.clientId,
    clientName: r.client.name,
    status: r.status as 'booked' | 'waitlisted',
    attended: r.attended,
  }));
}

/**
 * Locks the class row so two people cannot take the last place at once. No raw SQL in TenantTx: a
 * no-op UPDATE takes the same row lock as SELECT ... FOR UPDATE until the transaction ends.
 */
async function lockClass(tx: TenantTx, classId: string) {
  await tx.groupClass.updateMany({ where: { id: classId }, data: { capacity: { increment: 0 } } });
}

/**
 * Books a place for a client (the client themself, or staff for any client). Full classes put the
 * client on the waitlist. Returns the resulting status.
 */
export async function enrollInClass(
  tx: TenantTx,
  actor: ActorContext,
  input: { classId: string; clientId?: string },
  opts: { now?: Date } = {},
): Promise<{ status: 'booked' | 'waitlisted' }> {
  assertCan(actor, 'class:book');
  const now = opts.now ?? new Date();
  const clientId = actor.role === 'client' ? actor.clientId : input.clientId;
  if (!clientId || !isUuid(clientId) || !isUuid(input.classId)) throw notFound();
  if (actor.role !== 'client') {
    const client = await tx.client.findFirst({
      where: { id: clientId, organizationId: actor.orgId, status: { in: ['active', 'invited'] } },
      select: { id: true },
    });
    if (!client) throw new DomainError('NOT_FOUND', 'Client not found.');
  }
  await lockClass(tx, input.classId);
  const cls = await tx.groupClass.findFirst({
    where: { id: input.classId, organizationId: actor.orgId },
    select: { id: true, capacity: true, startsAt: true, cancelledAt: true },
  });
  if (!cls || cls.cancelledAt) throw notFound();
  if (cls.startsAt <= now) throw new DomainError('CONFLICT', 'This class has already started.');
  const existing = await tx.classEnrollment.findUnique({
    where: { classId_clientId: { classId: cls.id, clientId } },
    select: { id: true, status: true },
  });
  if (existing && existing.status !== 'cancelled') {
    return { status: existing.status as 'booked' | 'waitlisted' };
  }
  const booked = await tx.classEnrollment.count({ where: { classId: cls.id, status: 'booked' } });
  const status = booked < cls.capacity ? 'booked' : 'waitlisted';
  if (existing) {
    // Rejoining puts them at the back of the waitlist (createdAt resets the queue position).
    await tx.classEnrollment.update({
      where: { id: existing.id },
      data: { status, attended: null, createdAt: now },
    });
  } else {
    await tx.classEnrollment.create({
      data: { organizationId: actor.orgId, classId: cls.id, clientId, status },
    });
  }
  return { status };
}

async function promoteWaitlist(tx: TenantTx, classId: string, capacity: number) {
  const booked = await tx.classEnrollment.count({ where: { classId, status: 'booked' } });
  const free = capacity - booked;
  if (free <= 0) return [];
  const next = await tx.classEnrollment.findMany({
    where: { classId, status: 'waitlisted' },
    orderBy: { createdAt: 'asc' },
    take: free,
    select: { id: true, clientId: true },
  });
  if (next.length > 0) {
    await tx.classEnrollment.updateMany({
      where: { id: { in: next.map((n) => n.id) } },
      data: { status: 'booked' },
    });
  }
  return next.map((n) => n.clientId);
}

/** Cancels a client's place; the first person waiting moves up. Returns who was promoted. */
export async function cancelEnrollment(
  tx: TenantTx,
  actor: ActorContext,
  input: { classId: string; clientId?: string },
  opts: { now?: Date } = {},
): Promise<{ promotedClientIds: string[] }> {
  assertCan(actor, 'class:book');
  const now = opts.now ?? new Date();
  const clientId = actor.role === 'client' ? actor.clientId : input.clientId;
  if (!clientId || !isUuid(clientId) || !isUuid(input.classId)) throw notFound();
  await lockClass(tx, input.classId);
  const cls = await tx.groupClass.findFirst({
    where: { id: input.classId, organizationId: actor.orgId },
    select: { id: true, capacity: true, startsAt: true },
  });
  if (!cls) throw notFound();
  if (cls.startsAt <= now) throw new DomainError('CONFLICT', 'This class has already started.');
  const { count } = await tx.classEnrollment.updateMany({
    where: { classId: cls.id, clientId, status: { in: ['booked', 'waitlisted'] } },
    data: { status: 'cancelled' },
  });
  if (count === 0) throw new DomainError('NOT_FOUND', 'No booking to cancel.');
  return { promotedClientIds: await promoteWaitlist(tx, cls.id, cls.capacity) };
}

/** Changes a class's capacity; raising it moves people up from the waitlist. Trainers. */
export async function setClassCapacity(
  tx: TenantTx,
  actor: ActorContext,
  classId: string,
  capacity: number,
): Promise<{ promotedClientIds: string[] }> {
  assertCan(actor, 'class:manage');
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
    throw invalid('capacity', 'Use 1-500 places.');
  }
  if (!isUuid(classId)) throw notFound();
  await lockClass(tx, classId);
  const { count } = await tx.groupClass.updateMany({
    where: { id: classId, organizationId: actor.orgId },
    data: { capacity },
  });
  if (count === 0) throw notFound();
  return { promotedClientIds: await promoteWaitlist(tx, classId, capacity) };
}

/** Cancels one class, or every future class in its series. Trainers. */
export async function cancelClass(
  tx: TenantTx,
  actor: ActorContext,
  classId: string,
  opts: { wholeSeries?: boolean; now?: Date } = {},
): Promise<{ cancelled: number }> {
  assertCan(actor, 'class:manage');
  if (!isUuid(classId)) throw notFound();
  const now = opts.now ?? new Date();
  const cls = await tx.groupClass.findFirst({
    where: { id: classId, organizationId: actor.orgId },
    select: { id: true, seriesId: true, startsAt: true },
  });
  if (!cls) throw notFound();
  const where = opts.wholeSeries
    ? {
        seriesId: cls.seriesId,
        organizationId: actor.orgId,
        startsAt: { gte: cls.startsAt, gt: now },
      }
    : { id: cls.id };
  const { count } = await tx.groupClass.updateMany({
    where: { ...where, cancelledAt: null },
    data: { cancelledAt: now },
  });
  return { cancelled: count };
}

/** Marks who came. Only booked clients, and only once the class has started. Trainers. */
export async function markAttendance(
  tx: TenantTx,
  actor: ActorContext,
  classId: string,
  marks: { clientId: string; attended: boolean }[],
  opts: { now?: Date } = {},
): Promise<{ marked: number }> {
  assertCan(actor, 'class:manage');
  if (!isUuid(classId)) throw notFound();
  const now = opts.now ?? new Date();
  const cls = await tx.groupClass.findFirst({
    where: { id: classId, organizationId: actor.orgId },
    select: { startsAt: true },
  });
  if (!cls) throw notFound();
  if (cls.startsAt > now)
    throw new DomainError('CONFLICT', 'Mark attendance once the class starts.');
  let marked = 0;
  for (const m of marks.slice(0, 500)) {
    if (!isUuid(m.clientId)) continue;
    const { count } = await tx.classEnrollment.updateMany({
      where: { classId, clientId: m.clientId, status: 'booked' },
      data: { attended: m.attended },
    });
    marked += count;
  }
  return { marked };
}
