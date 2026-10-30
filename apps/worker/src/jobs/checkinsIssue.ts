import { issueDueCheckins } from '@kinetic/core';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { defineJob } from './registry';

export const CHECKINS_ISSUE = 'checkins.issue';
/** pg-boss cron: every 10 minutes (D-010 #3). */
export const CHECKINS_ISSUE_CRON = '*/10 * * * *';

/**
 * Issues due weekly check-ins in every organization that has a client with a check-in weekday (S4-1). The scan is a
 * system read; each organization is issued in its own tenant transaction, and `issueDueCheckins` is idempotent, so
 * overlapping or repeated runs issue each check-in once.
 */
export async function issueCheckins(prisma: PrismaClient, now: Date): Promise<{ issued: number }> {
  const orgs = await withSystem(
    (tx) =>
      tx.client.findMany({
        where: { status: 'active', checkinWeekday: { not: null } },
        distinct: ['organizationId'],
        select: { organizationId: true },
      }),
    prisma,
  );
  let issued = 0;
  for (const { organizationId } of orgs) {
    const res = await withTenant(organizationId, (tx) => issueDueCheckins(tx, now), prisma);
    issued += res.issued;
  }
  return { issued };
}

export const checkinsIssueJob = defineJob<object>({
  name: CHECKINS_ISSUE,
  cron: CHECKINS_ISSUE_CRON,
  async handle(_data, deps) {
    const { issued } = await issueCheckins(deps.prisma, new Date());
    if (issued > 0) deps.logger.info({ issued }, 'check-ins issued');
  },
});
