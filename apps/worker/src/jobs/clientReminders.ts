import { queueClientReminders, type Logger, activeOrgWhere } from '@kinetic/core';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { defineJob, type CaptureException } from './registry';

export const CLIENT_REMINDERS = 'clients.reminders';
/** pg-boss cron: hourly; each client's reminders go out from their local hour (PRD H13, F9). */
export const CLIENT_REMINDERS_CRON = '17 * * * *';

/**
 * Queues reminder emails in every organization with a client who opted in. The scan is a system read; each
 * organization runs in its own tenant transaction, and per-day idempotency keys send each reminder once.
 */
export async function runClientReminders(
  prisma: PrismaClient,
  now: Date,
  report: { logger?: Pick<Logger, 'error'>; captureException?: CaptureException } = {},
): Promise<{ queued: number; failed: number }> {
  const orgs = await withSystem(async (tx) => {
    const users = await tx.notificationPreference.findMany({
      where: {
        OR: [
          { workoutReminderOptIn: true },
          { checkinReminderOptIn: true },
          { habitReminderOptIn: true },
        ],
      },
      select: { userId: true },
    });
    if (users.length === 0) return [];
    return tx.membership.findMany({
      where: {
        userId: { in: users.map((u) => u.userId) },
        role: 'client',
        status: 'active',
        organization: activeOrgWhere(now),
      },
      distinct: ['organizationId'],
      select: { organizationId: true },
    });
  }, prisma);
  let queued = 0;
  let failed = 0;
  for (const { organizationId } of orgs) {
    try {
      const res = await withTenant(organizationId, (tx) => queueClientReminders(tx, now), prisma);
      queued += res.queued;
    } catch (error) {
      failed += 1;
      const errName = error instanceof Error ? error.name : 'unknown';
      report.logger?.error({ orgId: organizationId, errName }, 'client reminders failed');
      report.captureException?.(new Error(`client reminders failed: ${errName}`), {
        orgId: organizationId,
      });
    }
  }
  return { queued, failed };
}

export const clientRemindersJob = defineJob<object>({
  name: CLIENT_REMINDERS,
  cron: CLIENT_REMINDERS_CRON,
  async handle(_data, deps) {
    const { queued } = await runClientReminders(deps.prisma, new Date(), deps);
    if (queued > 0) deps.logger.info({ queued }, 'client reminders queued');
  },
});
