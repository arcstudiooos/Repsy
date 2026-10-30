import { evaluateRules } from '@kinetic/core';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { defineJob } from './registry';

export const REVIEW_SWEEP = 'review.sweep';
/** pg-boss cron: every 10 minutes (D-005 review-queue timing). */
export const REVIEW_SWEEP_CRON = '*/10 * * * *';

/**
 * Runs the review rules in every organization (S4-2): missed/incomplete derivation, snooze expiry, auto-resolve
 * and the time-based rules. Each organization runs in its own tenant transaction; the rules are idempotent, so an
 * overlapping or repeated run changes nothing.
 */
export async function sweepReview(
  prisma: PrismaClient,
  now: Date,
): Promise<{ orgs: number; opened: number; resolved: number; reopened: number }> {
  const orgs = await withSystem((tx) => tx.organization.findMany({ select: { id: true } }), prisma);
  const total = { orgs: orgs.length, opened: 0, resolved: 0, reopened: 0 };
  for (const { id } of orgs) {
    const r = await withTenant(id, (tx) => evaluateRules(tx, id, now), prisma);
    total.opened += r.opened;
    total.resolved += r.resolved;
    total.reopened += r.reopened;
  }
  return total;
}

export const reviewSweepJob = defineJob<object>({
  name: REVIEW_SWEEP,
  cron: REVIEW_SWEEP_CRON,
  async handle(_data, deps) {
    const { opened, resolved, reopened } = await sweepReview(deps.prisma, new Date());
    if (opened + resolved + reopened > 0) {
      deps.logger.info({ opened, resolved, reopened }, 'review sweep');
    }
  },
});
