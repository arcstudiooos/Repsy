import { activeOrgWhere, issueDueCheckins, type Logger } from '@kinetic/core';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { defineJob, type CaptureException } from './registry';

export const CHECKINS_ISSUE = 'checkins.issue';
/** pg-boss cron: every 10 minutes (D-010 #3). */
export const CHECKINS_ISSUE_CRON = '*/10 * * * *';
/** An organization's issuing transaction may run this long (Prisma's default is 5 s). */
const ISSUE_TIMEOUT_MS = 60_000;

/**
 * Issues due weekly check-ins in every organization that has a client with a check-in weekday (S4-1). The scan is a
 * system read; each organization is issued in its own tenant transaction, and `issueDueCheckins` is idempotent, so
 * overlapping or repeated runs issue each check-in once.
 */
export async function issueCheckins(
  prisma: PrismaClient,
  now: Date,
  report: { logger?: Pick<Logger, 'error'>; captureException?: CaptureException } = {},
): Promise<{ issued: number; failed: number }> {
  const orgs = await withSystem(
    (tx) =>
      tx.client.findMany({
        // PRD M12: nothing is issued for a lapsed workspace.
        where: {
          status: { in: ['active', 'paused'] },
          checkinWeekday: { not: null },
          organization: activeOrgWhere(now),
        },
        distinct: ['organizationId'],
        select: { organizationId: true },
      }),
    prisma,
  );
  let issued = 0;
  let failed = 0;
  for (const { organizationId } of orgs) {
    // One organization's failure never stops the others (PR #2 review B-I4); the next run retries it.
    try {
      const res = await withTenant(organizationId, (tx) => issueDueCheckins(tx, now), prisma, {
        timeout: ISSUE_TIMEOUT_MS,
      });
      issued += res.issued;
    } catch (error) {
      failed += 1;
      const errName = error instanceof Error ? error.name : 'unknown';
      report.logger?.error({ orgId: organizationId, errName }, 'check-in issuing failed');
      report.captureException?.(new Error(`check-in issuing failed: ${errName}`), {
        orgId: organizationId,
      });
    }
  }
  return { issued, failed };
}

export const checkinsIssueJob = defineJob<object>({
  name: CHECKINS_ISSUE,
  cron: CHECKINS_ISSUE_CRON,
  async handle(_data, deps) {
    const { issued } = await issueCheckins(deps.prisma, new Date(), deps);
    if (issued > 0) deps.logger.info({ issued }, 'check-ins issued');
  },
});
