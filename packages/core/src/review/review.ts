import { appendAudit, type TenantTx } from '@repsy/db';
import { STAFF_ROLES } from '../authz/actor';
import type { ActorContext } from '../authz/actor';
import { assertCan } from '../authz/policies';
import { DomainError } from '../errors';
import { isoWeekOf, summarize, SUMMARY_SELECT, toDbDate } from '../sessions/read';
import type { SessionState } from '../sessions/types';
import { todayInZone } from '../timezone';

export const REVIEW_LIST_MAX = 50;
/** Before a coach first marks the list seen, "new" means completed in the last 14 days. */
export const REVIEW_FIRST_WINDOW_MS = 14 * 86_400_000;

export interface ReviewItem {
  sessionId: string;
  clientId: string;
  clientName: string;
  title: string;
  scheduledLocalDate: string;
  state: SessionState;
  completedAt: string | null;
  loggedByCoach: boolean;
  /** PRD D13: an extra workout the client logged unplanned. */
  extra: boolean;
  /** PRD D17: readiness before Start (0-100), if answered. */
  readinessScore: number | null;
  /** Exercises swapped for an alternative in this session (PRD D8). */
  swapCount: number;
  /** PRD D10: form-check videos on the session. */
  formCheckCount: number;
}

export interface ReviewSection {
  /** All matching sessions; `items` holds at most REVIEW_LIST_MAX of them. */
  count: number;
  items: ReviewItem[];
}

export interface ReviewOverview {
  /** The instant this overview was read: "Mark all as seen" marks through it, never later. */
  generatedAt: string;
  seenAt: string | null;
  /** The ISO week (Mon–Sun) used for "this week", in the organization's time zone. */
  week: { startLocalDate: string; endLocalDate: string };
  newCompleted: ReviewSection;
  dueThisWeek: ReviewSection;
  skippedThisWeek: ReviewSection;
}

/** The acting coach's own membership row in this org (owner or coach). */
function ownMembership(tx: TenantTx, actor: ActorContext) {
  return tx.membership.findFirst({
    where: { userId: actor.userId, role: { in: [...STAFF_ROLES] }, status: 'active' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, reviewSeenAt: true },
  });
}

/** The acting coach's "new since" instant and this week's dates in the organization's time zone. */
async function reviewWindow(tx: TenantTx, actor: ActorContext, now: Date) {
  assertCan(actor, 'review:read');
  const membership = await ownMembership(tx, actor);
  const org = await tx.organization.findFirst({
    where: { id: actor.orgId },
    select: { timezone: true },
  });
  if (!org) throw new DomainError('NOT_FOUND', 'Not found.');
  const seenAt = membership?.reviewSeenAt ?? null;
  const since = seenAt ?? new Date(now.getTime() - REVIEW_FIRST_WINDOW_MS);
  const { start, end } = isoWeekOf(todayInZone(org.timezone, now));
  const week = { scheduledLocalDate: { gte: toDbDate(start), lte: toDbDate(end) } };
  return { seenAt, since, start, end, week };
}

/**
 * Sprint 2 review list (S2-4, D-009): plain read queries over WorkoutSession, no ReviewFlag rows (those arrive in
 * S4-2). Everything runs in the coach's tenant transaction, so another organization's sessions never appear.
 * "This week" compares the stored client-local dates with the ISO week containing today in the organization's
 * time zone: a documented Sprint 2 approximation for clients in other zones.
 */
export async function getReviewOverview(
  tx: TenantTx,
  actor: ActorContext,
  opts: { now?: Date; coachUserIds?: string[] | null } = {},
): Promise<ReviewOverview> {
  const now = opts.now ?? new Date();
  const { seenAt, since, start, end, week } = await reviewWindow(tx, actor, now);
  // PRD A12: "My clients".
  const mine = opts.coachUserIds
    ? { client: { is: { coachUserId: { in: opts.coachUserIds } } } }
    : {};

  const section = async (
    scoped: Record<string, unknown>,
    orderBy: Record<string, 'asc' | 'desc'>[],
  ): Promise<ReviewSection> => {
    const where = { ...scoped, ...mine };
    const count = await tx.workoutSession.count({ where });
    const rows = await tx.workoutSession.findMany({
      where,
      orderBy,
      take: REVIEW_LIST_MAX,
      select: SUMMARY_SELECT,
    });
    const summaries = await summarize(tx, rows, now);
    const clients = rows.length
      ? await tx.client.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.clientId))] } },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(clients.map((c) => [c.id, c.name]));
    const swapRows = rows.length
      ? await tx.sessionExerciseSwap.groupBy({
          by: ['sessionId'],
          where: { sessionId: { in: rows.map((r) => r.id) } },
          _count: { _all: true },
        })
      : [];
    const swapCount = new Map(swapRows.map((r) => [r.sessionId, r._count._all]));
    const videoRows = rows.length
      ? await tx.sessionMedia.groupBy({
          by: ['sessionId'],
          where: { sessionId: { in: rows.map((r) => r.id) } },
          _count: { _all: true },
        })
      : [];
    const videoCount = new Map(videoRows.map((r) => [r.sessionId, r._count._all]));
    return {
      count,
      items: summaries.map((s) => ({
        sessionId: s.id,
        clientId: s.clientId,
        clientName: names.get(s.clientId) ?? '',
        title: s.title,
        scheduledLocalDate: s.scheduledLocalDate,
        state: s.state,
        completedAt: s.completedAt,
        loggedByCoach: s.loggedByCoach,
        extra: s.extra,
        readinessScore: s.readinessScore,
        swapCount: swapCount.get(s.id) ?? 0,
        formCheckCount: videoCount.get(s.id) ?? 0,
      })),
    };
  };

  return {
    generatedAt: now.toISOString(),
    seenAt: seenAt?.toISOString() ?? null,
    week: { startLocalDate: start, endLocalDate: end },
    newCompleted: await section({ state: 'completed', completedAt: { gt: since } }, [
      { completedAt: 'desc' },
      { id: 'desc' },
    ]),
    dueThisWeek: await section({ state: { in: ['scheduled', 'in_progress'] }, ...week }, [
      { dueAt: 'asc' },
      { id: 'asc' },
    ]),
    skippedThisWeek: await section({ state: 'skipped', ...week }, [
      { scheduledLocalDate: 'desc' },
      { id: 'desc' },
    ]),
  };
}

/**
 * "Mark all as seen" for the list the coach was shown: the marker moves to `through` (the overview's `generatedAt`),
 * capped at now and never backwards, so a completion that arrived after the list was rendered stays new.
 */
export async function markReviewSeen(
  tx: TenantTx,
  actor: ActorContext,
  input: { through: string },
  opts: { now?: Date; requestId?: string } = {},
): Promise<{ seenAt: string }> {
  assertCan(actor, 'review:update');
  const now = opts.now ?? new Date();
  const through = new Date(input.through);
  if (Number.isNaN(through.getTime())) {
    throw new DomainError('VALIDATION', 'Some fields are invalid.', { through: ['Invalid.'] });
  }
  const mark = through < now ? through : now;
  const membership = await ownMembership(tx, actor);
  if (!membership) throw new DomainError('NOT_FOUND', 'Not found.');
  if (membership.reviewSeenAt && membership.reviewSeenAt >= mark) {
    return { seenAt: membership.reviewSeenAt.toISOString() };
  }
  await tx.membership.updateMany({ where: { id: membership.id }, data: { reviewSeenAt: mark } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'membership',
    objectId: membership.id,
    action: 'review.seen',
    requestId: opts.requestId,
  });
  return { seenAt: mark.toISOString() };
}

/** Dashboard counts only: three counts, no list reads. Same filters as `getReviewOverview`. */
export async function getReviewCounts(
  tx: TenantTx,
  actor: ActorContext,
  opts: { now?: Date } = {},
): Promise<{ newCompleted: number; dueThisWeek: number; skippedThisWeek: number }> {
  const { since, week } = await reviewWindow(tx, actor, opts.now ?? new Date());
  return {
    newCompleted: await tx.workoutSession.count({
      where: { state: 'completed', completedAt: { gt: since } },
    }),
    dueThisWeek: await tx.workoutSession.count({
      where: { kind: 'planned', state: { in: ['scheduled', 'in_progress'] }, ...week },
    }),
    skippedThisWeek: await tx.workoutSession.count({
      where: { kind: 'planned', state: 'skipped', ...week },
    }),
  };
}
