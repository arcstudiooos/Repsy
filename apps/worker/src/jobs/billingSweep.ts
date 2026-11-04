import { expireGraces, retryDueSubscription, type Logger } from '@kinetic/core';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { defineJob, type CaptureException } from './registry';

export const BILLING_SWEEP = 'billing.sweep';
/** pg-boss cron: every 15 minutes. */
export const BILLING_SWEEP_CRON = '*/15 * * * *';

/**
 * PRD K7: retries every subscription whose retry date has arrived, then pauses every subscription whose grace period
 * has ended. The scan is a system read; each change runs in its own organization's tenant transaction, and the core
 * functions re-check under the row lock, so overlapping runs (or a coach's manual retry) never charge twice. One
 * failing subscription never holds back the others; the next run tries it again.
 */
export async function sweepBilling(
  prisma: PrismaClient,
  now: Date,
  report: { logger?: Pick<Logger, 'error'>; captureException?: CaptureException } = {},
): Promise<{ retried: number; paused: number; failed: number }> {
  const { due, graceOrgs } = await withSystem(
    async (tx) => ({
      due: await tx.subscription.findMany({
        where: {
          status: { in: ['past_due', 'grace'] },
          needsReview: false,
          nextRetryAt: { lte: now },
        },
        select: { id: true, organizationId: true },
        take: 500,
      }),
      graceOrgs: await tx.subscription.findMany({
        where: { status: 'grace', graceEndsAt: { lte: now } },
        distinct: ['organizationId'],
        select: { organizationId: true },
      }),
    }),
    prisma,
  );
  let retried = 0;
  let paused = 0;
  let failed = 0;
  const fail = (error: unknown, what: string, id: string) => {
    failed += 1;
    const errName = error instanceof Error ? error.name : 'unknown';
    report.logger?.error({ id, errName }, `${what} failed`);
    report.captureException?.(new Error(`${what} failed: ${errName}`), { id });
  };
  for (const s of due) {
    try {
      const done = await withTenant(
        s.organizationId,
        (tx) => retryDueSubscription(tx, s.organizationId, s.id, undefined, now),
        prisma,
      );
      if (done) retried += 1;
    } catch (error) {
      fail(error, 'billing retry', s.id);
    }
  }
  // After the retries, so a successful retry clears a grace period before it would pause.
  for (const { organizationId } of graceOrgs) {
    try {
      paused += (await withTenant(organizationId, (tx) => expireGraces(tx, now), prisma)).paused;
    } catch (error) {
      fail(error, 'grace expiry', organizationId);
    }
  }
  return { retried, paused, failed };
}

export const billingSweepJob = defineJob<object>({
  name: BILLING_SWEEP,
  cron: BILLING_SWEEP_CRON,
  async handle(_data, deps) {
    const { retried, paused } = await sweepBilling(deps.prisma, new Date(), deps);
    if (retried > 0 || paused > 0) deps.logger.info({ retried, paused }, 'billing swept');
  },
});
