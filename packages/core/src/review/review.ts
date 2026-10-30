import { appendAudit, type TenantTx } from '@kinetic/db';
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
}

export interface ReviewSection {
  /** All matching sessions; `items` holds at most REVIEW_LIST_MAX of them. */
  count: number;
  items: ReviewItem[];
}

export interface ReviewOverview {
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
    where: { userId: actor.userId, role: { in: ['owner', 'coach'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, reviewSeenAt: true },
  });
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
  opts: { now?: Date } = {},
): Promise<ReviewOverview> {
  assertCan(actor, 'review:read');
  const now = opts.now ?? new Date();
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

  const section = async (
    where: Record<string, unknown>,
    orderBy: Record<string, 'asc' | 'desc'>[],
  ): Promise<ReviewSection> => {
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
      })),
    };
  };

  return {
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

/** "Mark all as seen": completions up to now stop counting as new for this coach. */
export async function markReviewSeen(
  tx: TenantTx,
  actor: ActorContext,
  opts: { now?: Date; requestId?: string } = {},
): Promise<{ seenAt: string }> {
  assertCan(actor, 'review:update');
  const now = opts.now ?? new Date();
  const membership = await ownMembership(tx, actor);
  if (!membership) throw new DomainError('NOT_FOUND', 'Not found.');
  await tx.membership.updateMany({ where: { id: membership.id }, data: { reviewSeenAt: now } });
  await appendAudit(tx, {
    orgId: actor.orgId,
    actorId: actor.userId,
    objectType: 'membership',
    objectId: membership.id,
    action: 'review.seen',
    requestId: opts.requestId,
  });
  return { seenAt: now.toISOString() };
}
