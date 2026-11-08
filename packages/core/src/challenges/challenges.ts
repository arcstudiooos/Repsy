import { appendAudit, type TenantTx } from '@repsy/db';
import { isCoachRole, type ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { displayName } from '../groups/groups';
import { fromDbDate, toDbDate } from '../sessions/read';
import { todayInZone } from '../timezone';
import { isUuid } from '../uuid';

/**
 * PRD H9: time-boxed challenges. A coach sets one up (workouts completed, days with a habit checked off, or total
 * training volume) for everyone or one group; clients join, and each chooses whether to appear on the leaderboard,
 * which shows display names only. Scores are counted from what was logged between the dates, in each client's own
 * calendar. Body metrics are never a challenge.
 */
export const CHALLENGE_METRICS = ['workouts', 'habit_days', 'volume'] as const;
export type ChallengeMetric = (typeof CHALLENGE_METRICS)[number];
export type ChallengeStatus = 'upcoming' | 'live' | 'ended';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ChallengeSummary {
  id: string;
  title: string;
  description: string;
  metric: ChallengeMetric;
  startLocalDate: string;
  endLocalDate: string;
  groupName: string | null;
  status: ChallengeStatus;
  participants: number;
  /** Clients only. */
  joined: boolean;
}

export interface LeaderboardEntry {
  rank: number | null;
  name: string;
  /** Workouts, days, or kg of volume. */
  score: number;
  me: boolean;
  onLeaderboard: boolean;
}

export interface ChallengeDetail extends ChallengeSummary {
  /** Clients see entries that opted in, plus their own; coaches see everyone. */
  leaderboard: LeaderboardEntry[];
  /** The viewing client's choice. */
  onLeaderboard: boolean;
  isCoach: boolean;
}

const notFound = () => new DomainError('NOT_FOUND', 'Not found.');
const invalid = (field: string, message: string) =>
  new DomainError('VALIDATION', 'Some fields are invalid.', { [field]: [message] });

function statusOf(start: string, end: string, today: string): ChallengeStatus {
  if (today < start) return 'upcoming';
  if (today > end) return 'ended';
  return 'live';
}

function cleanDate(v: unknown, field: string): string {
  if (typeof v !== 'string' || !DATE.test(v) || fromDbDate(toDbDate(v)) !== v) {
    throw invalid(field, 'Pick a date.');
  }
  return v;
}

export async function saveChallenge(
  tx: TenantTx,
  actor: ActorContext,
  input: Record<string, unknown>,
  opts: { requestId?: string } = {},
): Promise<{ id: string }> {
  assertCan(actor, 'client:update');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 1 || title.length > 120) throw invalid('title', 'Use 1-120 characters.');
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length > 2000) throw invalid('description', 'Use at most 2000 characters.');
  if (!(CHALLENGE_METRICS as readonly unknown[]).includes(input.metric)) {
    throw invalid('metric', 'Pick what counts.');
  }
  const start = cleanDate(input.startLocalDate, 'startLocalDate');
  const end = cleanDate(input.endLocalDate, 'endLocalDate');
  if (end < start) throw invalid('endLocalDate', 'End on or after the start.');
  if ((toDbDate(end).getTime() - toDbDate(start).getTime()) / 86_400_000 > 366) {
    throw invalid('endLocalDate', 'Keep it to a year at most.');
  }
  let groupId: string | null = null;
  if (input.groupId) {
    if (!isUuid(input.groupId)) throw invalid('groupId', 'Pick a group.');
    const g = await tx.group.findFirst({
      where: { id: input.groupId, archivedAt: null },
      select: { id: true },
    });
    if (!g) throw invalid('groupId', 'That group no longer exists.');
    groupId = g.id;
  }
  const data = {
    title,
    description,
    metric: input.metric as string,
    startLocalDate: toDbDate(start),
    endLocalDate: toDbDate(end),
    groupId,
  };
  let id: string;
  if (input.id !== undefined) {
    if (!isUuid(input.id)) throw notFound();
    const { count } = await tx.challenge.updateMany({
      where: { id: input.id, archivedAt: null },
      data,
    });
    if (count === 0) throw notFound();
    id = input.id;
  } else {
    const row = await tx.challenge.create({
      data: { ...data, createdBy: actor.userId },
      select: { id: true },
    } as Parameters<typeof tx.challenge.create>[0]);
    id = (row as { id: string }).id;
  }
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'challenge',
    objectId: id,
    action: input.id === undefined ? 'challenge.created' : 'challenge.updated',
    requestId: opts.requestId,
  });
  return { id };
}

export async function archiveChallenge(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  opts: { requestId?: string } = {},
): Promise<void> {
  assertCan(actor, 'client:update');
  if (!isUuid(id)) throw notFound();
  const { count } = await tx.challenge.updateMany({
    where: { id, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  if (count === 0) throw notFound();
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'challenge',
    objectId: id,
    action: 'challenge.archived',
    requestId: opts.requestId,
  });
}

const SUMMARY_SELECT = {
  id: true,
  title: true,
  description: true,
  metric: true,
  startLocalDate: true,
  endLocalDate: true,
  groupId: true,
  group: { select: { name: true } },
  _count: { select: { participants: true } },
} as const;

async function clientContext(tx: TenantTx, actor: ActorContext) {
  if (!actor.clientId) throw notFound();
  const client = await tx.client.findFirstOrThrow({
    where: { id: actor.clientId },
    select: { timezone: true, groupMembers: { select: { groupId: true } } },
  });
  return { timezone: client.timezone, groups: client.groupMembers.map((g) => g.groupId) };
}

/** Coaches: every challenge. Clients: the ones open to them (everyone's, or their groups'). */
export async function listChallenges(
  tx: TenantTx,
  actor: ActorContext,
  now: Date = new Date(),
): Promise<ChallengeSummary[]> {
  assertCan(actor, 'session:read');
  const coach = isCoachRole(actor.role);
  let where: Record<string, unknown> = { archivedAt: null };
  let timezone: string;
  if (coach) {
    const org = await tx.organization.findFirstOrThrow({ select: { timezone: true } });
    timezone = org.timezone;
  } else {
    const ctx = await clientContext(tx, actor);
    timezone = ctx.timezone;
    where = { archivedAt: null, OR: [{ groupId: null }, { groupId: { in: ctx.groups } }] };
  }
  const today = todayInZone(timezone, now);
  const rows = await tx.challenge.findMany({
    where,
    orderBy: [{ startLocalDate: 'desc' }, { id: 'asc' }],
    take: 100,
    select: {
      ...SUMMARY_SELECT,
      participants: coach
        ? false
        : { where: { clientId: actor.clientId ?? '' }, select: { clientId: true } },
    },
  });
  return rows.map((r) => summary(r, today, !coach && (r.participants?.length ?? 0) > 0));
}

function summary(
  r: {
    id: string;
    title: string;
    description: string;
    metric: string;
    startLocalDate: Date;
    endLocalDate: Date;
    group: { name: string } | null;
    _count: { participants: number };
  },
  today: string,
  joined: boolean,
): ChallengeSummary {
  const start = fromDbDate(r.startLocalDate);
  const end = fromDbDate(r.endLocalDate);
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    metric: r.metric as ChallengeMetric,
    startLocalDate: start,
    endLocalDate: end,
    groupName: r.group?.name ?? null,
    status: statusOf(start, end, today),
    participants: r._count.participants,
    joined,
  };
}

/** Each participant's score between the dates (inclusive). */
async function scores(
  tx: TenantTx,
  metric: ChallengeMetric,
  clientIds: string[],
  start: Date,
  end: Date,
): Promise<Map<string, number>> {
  const out = new Map(clientIds.map((c) => [c, 0]));
  if (clientIds.length === 0) return out;
  const inRange = { gte: start, lte: end };
  if (metric === 'workouts') {
    const rows = await tx.workoutSession.groupBy({
      by: ['clientId'],
      where: { clientId: { in: clientIds }, state: 'completed', scheduledLocalDate: inRange },
      _count: { _all: true },
    });
    for (const r of rows) out.set(r.clientId, r._count._all);
  } else if (metric === 'habit_days') {
    const rows = await tx.habitLog.groupBy({
      by: ['clientId', 'localDate'],
      where: { clientId: { in: clientIds }, localDate: inRange },
    });
    for (const r of rows) out.set(r.clientId, (out.get(r.clientId) ?? 0) + 1);
  } else {
    const rows = await tx.setLog.findMany({
      where: {
        weightKg: { not: null },
        reps: { not: null },
        session: {
          is: { clientId: { in: clientIds }, state: 'completed', scheduledLocalDate: inRange },
        },
      },
      select: { weightKg: true, reps: true, session: { select: { clientId: true } } },
    });
    for (const r of rows) {
      const c = r.session.clientId;
      out.set(c, (out.get(c) ?? 0) + Number(r.weightKg) * (r.reps ?? 0));
    }
    for (const [c, v] of out) out.set(c, Math.round(v));
  }
  return out;
}

export async function getChallenge(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  now: Date = new Date(),
): Promise<ChallengeDetail> {
  assertCan(actor, 'session:read');
  if (!isUuid(id)) throw notFound();
  const coach = isCoachRole(actor.role);
  const row = await tx.challenge.findFirst({
    where: { id, archivedAt: null },
    select: {
      ...SUMMARY_SELECT,
      participants: {
        select: { clientId: true, onLeaderboard: true, client: { select: { name: true } } },
      },
    },
  });
  if (!row) throw notFound();
  let timezone: string;
  if (coach) {
    timezone = (await tx.organization.findFirstOrThrow({ select: { timezone: true } })).timezone;
  } else {
    const ctx = await clientContext(tx, actor);
    if (row.groupId && !ctx.groups.includes(row.groupId)) throw notFound();
    timezone = ctx.timezone;
  }
  const today = todayInZone(timezone, now);
  const mine = row.participants.find((p) => p.clientId === actor.clientId);
  const s = await scores(
    tx,
    row.metric as ChallengeMetric,
    row.participants.map((p) => p.clientId),
    row.startLocalDate,
    row.endLocalDate,
  );
  const entries = row.participants
    .filter((p) => coach || p.onLeaderboard || p.clientId === actor.clientId)
    .map((p) => ({
      clientId: p.clientId,
      name: coach ? p.client.name : displayName(p.client.name),
      score: s.get(p.clientId) ?? 0,
      me: p.clientId === actor.clientId,
      onLeaderboard: p.onLeaderboard,
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  // Ranks count only the people on the leaderboard; someone who opted out has no rank, even to themselves.
  let rank = 0;
  let last: number | null = null;
  let seen = 0;
  const leaderboard: LeaderboardEntry[] = entries.map((e) => {
    if (!e.onLeaderboard)
      return { rank: null, name: e.name, score: e.score, me: e.me, onLeaderboard: false };
    seen += 1;
    if (e.score !== last) rank = seen;
    last = e.score;
    return { rank, name: e.name, score: e.score, me: e.me, onLeaderboard: true };
  });
  return {
    ...summary(row, today, !coach && mine !== undefined),
    leaderboard,
    onLeaderboard: mine?.onLeaderboard ?? false,
    isCoach: coach,
  };
}

/** The client joins (or updates their leaderboard choice). Ended challenges can't be joined. */
export async function joinChallenge(
  tx: TenantTx,
  actor: ActorContext,
  id: string,
  input: { onLeaderboard?: unknown },
  now: Date = new Date(),
): Promise<void> {
  assertCan(actor, 'session:log');
  if (actor.role !== 'client' || !actor.clientId) throw notFound();
  const detail = await getChallenge(tx, actor, id, now);
  const onLeaderboard = input.onLeaderboard === true;
  if (detail.joined) {
    await tx.challengeParticipant.updateMany({
      where: { challengeId: id, clientId: actor.clientId },
      data: { onLeaderboard },
    });
    return;
  }
  if (detail.status === 'ended') throw new DomainError('CONFLICT', 'This challenge has ended.');
  await tx.challengeParticipant.create({
    data: { challengeId: id, clientId: actor.clientId, onLeaderboard },
  } as Parameters<typeof tx.challengeParticipant.create>[0]);
}

export async function leaveChallenge(tx: TenantTx, actor: ActorContext, id: string): Promise<void> {
  assertCan(actor, 'session:log');
  if (actor.role !== 'client' || !actor.clientId || !isUuid(id)) throw notFound();
  await tx.challengeParticipant.deleteMany({
    where: { challengeId: id, clientId: actor.clientId },
  });
}
