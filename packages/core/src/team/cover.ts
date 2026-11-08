import { appendAudit, type TenantTx } from '@repsy/db';
import { isManager, TRAINER_ROLES, type ActorContext } from '../authz/actor';
import { DomainError } from '../errors';
import { zonedTimeToUtc } from '../timezone';
import { isUuid } from '../uuid';

/**
 * PRD A13: cover and holiday mode. A coach (for themselves) or an owner or admin hands a coach's queue to another
 * coach for a date range in the workspace's time zone. While it runs, the covering coach's "My clients" and review
 * queue include those clients, client messages notify the covering coach, and clients see who is covering.
 */
export const COVER_MAX_DAYS = 120;

export interface CoverView {
  id: string;
  coachUserId: string;
  coachName: string;
  coverUserId: string;
  coverName: string;
  startsAt: string;
  endsAt: string;
}

const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function createCover(
  tx: TenantTx,
  actor: ActorContext,
  input: { coachUserId?: unknown; coverUserId?: unknown; startDate?: unknown; endDate?: unknown },
  opts: { now?: Date; requestId?: string } = {},
): Promise<CoverView> {
  const coachUserId = input.coachUserId ?? actor.userId;
  if (!isUuid(coachUserId) || !isUuid(input.coverUserId))
    throw invalid('coverUserId', 'Pick a coach.');
  if (!isManager(actor.role) && !(actor.role === 'coach' && coachUserId === actor.userId)) {
    throw new DomainError(
      'FORBIDDEN',
      'Only the owner or an admin can set cover for someone else.',
    );
  }
  if (coachUserId === input.coverUserId)
    throw invalid('coverUserId', 'Pick someone else to cover.');
  const trainers = await tx.membership.findMany({
    where: {
      userId: { in: [coachUserId, input.coverUserId] },
      status: 'active',
      role: { in: [...TRAINER_ROLES] },
    },
    select: { userId: true, user: { select: { name: true } } },
  });
  const name = new Map(trainers.map((t) => [t.userId, t.user.name]));
  if (!name.has(coachUserId) || !name.has(input.coverUserId)) {
    throw invalid('coverUserId', 'Pick a coach on this team.');
  }
  if (typeof input.startDate !== 'string' || !DATE.test(input.startDate))
    throw invalid('startDate', 'Pick a start date.');
  if (typeof input.endDate !== 'string' || !DATE.test(input.endDate))
    throw invalid('endDate', 'Pick an end date.');
  if (input.endDate < input.startDate) throw invalid('endDate', 'End on or after the start.');
  const org = await tx.organization.findFirstOrThrow({ select: { timezone: true } });
  const startsAt = zonedTimeToUtc(input.startDate, '00:00', org.timezone);
  const dayAfter = new Date(Date.parse(`${input.endDate}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const endsAt = zonedTimeToUtc(dayAfter, '00:00', org.timezone);
  if (!startsAt || !endsAt) throw invalid('startDate', 'Pick valid dates.');
  const now = opts.now ?? new Date();
  if (endsAt <= now) throw invalid('endDate', 'Pick an end date in the future.');
  if (endsAt.getTime() - startsAt.getTime() > COVER_MAX_DAYS * 86_400_000) {
    throw invalid('endDate', `Cover lasts at most ${COVER_MAX_DAYS} days.`);
  }
  const overlap = await tx.coachCover.count({
    where: { coachUserId, cancelledAt: null, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
  });
  if (overlap > 0) throw new DomainError('CONFLICT', 'There is already cover for those dates.');
  const row = await tx.coachCover.create({
    data: {
      coachUserId,
      coverUserId: input.coverUserId,
      startsAt,
      endsAt,
      createdBy: actor.userId,
    },
  } as Parameters<typeof tx.coachCover.create>[0]);
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'coach_cover',
    objectId: row.id,
    action: 'team.cover_set',
    metadata: {
      coachUserId,
      coverUserId: input.coverUserId,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    },
    requestId: opts.requestId,
  });
  return {
    id: row.id,
    coachUserId,
    coachName: name.get(coachUserId)!,
    coverUserId: input.coverUserId,
    coverName: name.get(input.coverUserId)!,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  };
}

/** Current and upcoming cover in the workspace. */
export async function listCovers(tx: TenantTx, now: Date = new Date()): Promise<CoverView[]> {
  const rows = await tx.coachCover.findMany({
    where: { cancelledAt: null, endsAt: { gt: now } },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      coachUserId: true,
      coverUserId: true,
      startsAt: true,
      endsAt: true,
      coach: { select: { name: true } },
      cover: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    coachUserId: r.coachUserId,
    coachName: r.coach.name,
    coverUserId: r.coverUserId,
    coverName: r.cover.name,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
  }));
}

export async function cancelCover(
  tx: TenantTx,
  actor: ActorContext,
  id: unknown,
  opts: { now?: Date; requestId?: string } = {},
): Promise<void> {
  if (!isUuid(id)) throw new DomainError('NOT_FOUND', 'Not found.');
  const row = await tx.coachCover.findFirst({
    where: { id, cancelledAt: null },
    select: { coachUserId: true },
  });
  if (!row) throw new DomainError('NOT_FOUND', 'Not found.');
  if (!isManager(actor.role) && row.coachUserId !== actor.userId) {
    throw new DomainError(
      'FORBIDDEN',
      'Only the owner, an admin or the coach away can end this cover.',
    );
  }
  await tx.coachCover.update({ where: { id }, data: { cancelledAt: opts.now ?? new Date() } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'coach_cover',
    objectId: id,
    action: 'team.cover_ended',
    requestId: opts.requestId,
  });
}

/** Who covers `coachUserId` right now, if anyone. */
export async function activeCover(
  tx: TenantTx,
  coachUserId: string,
  now: Date = new Date(),
): Promise<{ coverUserId: string; coverName: string; endsAt: Date } | null> {
  const row = await tx.coachCover.findFirst({
    where: { coachUserId, cancelledAt: null, startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: { startsAt: 'desc' },
    select: { coverUserId: true, endsAt: true, cover: { select: { name: true } } },
  });
  return row
    ? { coverUserId: row.coverUserId, coverName: row.cover.name, endsAt: row.endsAt }
    : null;
}

/** For the client's portal: their coach's name, and who covers until when (null when no one does). */
export async function coverForClient(
  tx: TenantTx,
  clientId: string,
  now: Date = new Date(),
): Promise<{ coachName: string; coverName: string; until: string } | null> {
  const client = await tx.client.findFirst({
    where: { id: clientId },
    select: { coachUserId: true, coach: { select: { name: true } } },
  });
  if (!client) return null;
  const cover = await activeCover(tx, client.coachUserId, now);
  if (!cover) return null;
  // The last day covered, in the workspace's zone.
  const org = await tx.organization.findFirstOrThrow({ select: { timezone: true } });
  const until = new Intl.DateTimeFormat('en-CA', { timeZone: org.timezone }).format(
    new Date(cover.endsAt.getTime() - 1),
  );
  return { coachName: client.coach.name, coverName: cover.coverName, until };
}
