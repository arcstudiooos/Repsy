import { evaluateRules, noopAnalytics, type AnalyticsPort, type Logger } from '@kinetic/core';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { orgHash, systemDistinctId } from '../adapters/analytics';
import { defineJob, type CaptureException } from './registry';

export const REVIEW_SWEEP = 'review.sweep';
/** pg-boss cron: every 10 minutes (D-005 review-queue timing). */
export const REVIEW_SWEEP_CRON = '*/10 * * * *';

/**
 * An organization's sweep transaction may run this long (Prisma's default is 5 s): the first sweep after a deploy
 * derives every past-due session at once (PR #2 review B-I4).
 */
export const SWEEP_TIMEOUT_MS = 120_000;

/**
 * Runs the review rules in every organization (S4-2): missed/incomplete derivation, snooze expiry, auto-resolve
 * and the time-based rules. Each organization runs in its own tenant transaction; the rules are idempotent, so an
 * overlapping or repeated run changes nothing. An organization that fails is logged (its id and the error class) and
 * reported, and the sweep goes on with the next one (B-I4).
 */
export async function sweepReview(
  prisma: PrismaClient,
  now: Date,
  analytics: AnalyticsPort = noopAnalytics,
  env: Record<string, string | undefined> = process.env,
  report: { logger?: Pick<Logger, 'error'>; captureException?: CaptureException } = {},
): Promise<{ orgs: number; opened: number; resolved: number; reopened: number; failed: number }> {
  const orgs = await withSystem((tx) => tx.organization.findMany({ select: { id: true } }), prisma);
  const total = { orgs: orgs.length, opened: 0, resolved: 0, reopened: 0, failed: 0 };
  for (const { id } of orgs) {
    let r;
    try {
      r = await withTenant(id, (tx) => evaluateRules(tx, id, now), prisma, {
        timeout: SWEEP_TIMEOUT_MS,
      });
    } catch (error) {
      total.failed += 1;
      const errName = error instanceof Error ? error.name : 'unknown';
      report.logger?.error({ orgId: id, errName }, 'review sweep failed');
      report.captureException?.(new Error(`review sweep failed: ${errName}`), { orgId: id });
      continue;
    }
    for (const rule of r.openedRules) {
      analytics.capture({
        name: 'review_flag_opened',
        distinctId: systemDistinctId(env, id),
        properties: { rule_key: rule, org_id_hash: orgHash(env, id) },
      });
    }
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
    const { opened, resolved, reopened } = await sweepReview(
      deps.prisma,
      new Date(),
      deps.analytics,
      process.env,
      deps,
    );
    if (opened + resolved + reopened > 0) {
      deps.logger.info({ opened, resolved, reopened }, 'review sweep');
    }
  },
});
