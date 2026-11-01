import { queueCoachDigests, queueWeeklyBriefs, type Logger } from '@kinetic/core';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { defineJob, type CaptureException } from './registry';

export const COACH_DIGEST = 'coach.digest';
/** pg-boss cron: hourly; each organization's digest goes out from 07:00 in its own time zone (PRD H14). */
export const COACH_DIGEST_CRON = '7 * * * *';

/**
 * Queues the daily coach digest (and on Mondays the weekly brief, PRD I9) in every organization with an opted-in coach. The scan is a system read; each
 * organization runs in its own tenant transaction, and the per-day idempotency key means each coach gets one digest.
 */
export async function runCoachDigests(
  prisma: PrismaClient,
  now: Date,
  report: { logger?: Pick<Logger, 'error'>; captureException?: CaptureException } = {},
): Promise<{ queued: number; failed: number }> {
  const orgs = await withSystem(async (tx) => {
    const users = await tx.notificationPreference.findMany({
      where: { OR: [{ digestEmailOptIn: true }, { weeklyBriefOptIn: true }] },
      select: { userId: true },
    });
    if (users.length === 0) return [];
    return tx.membership.findMany({
      where: {
        userId: { in: users.map((u) => u.userId) },
        role: { in: ['owner', 'coach'] },
        status: 'active',
      },
      distinct: ['organizationId'],
      select: { organizationId: true },
    });
  }, prisma);
  let queued = 0;
  let failed = 0;
  for (const { organizationId } of orgs) {
    try {
      const res = await withTenant(
        organizationId,
        async (tx) => {
          const daily = await queueCoachDigests(tx, organizationId, now);
          // PRD I9: the Monday brief rides the same hourly scan.
          const weekly = await queueWeeklyBriefs(tx, organizationId, now);
          return { queued: daily.queued + weekly.queued };
        },
        prisma,
      );
      queued += res.queued;
    } catch (error) {
      failed += 1;
      const errName = error instanceof Error ? error.name : 'unknown';
      report.logger?.error({ orgId: organizationId, errName }, 'coach digest failed');
      report.captureException?.(new Error(`coach digest failed: ${errName}`), {
        orgId: organizationId,
      });
    }
  }
  return { queued, failed };
}

export const coachDigestJob = defineJob<object>({
  name: COACH_DIGEST,
  cron: COACH_DIGEST_CRON,
  async handle(_data, deps) {
    const { queued } = await runCoachDigests(deps.prisma, new Date(), deps);
    if (queued > 0) deps.logger.info({ queued }, 'coach digests queued');
  },
});
