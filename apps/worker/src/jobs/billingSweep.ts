import { expireStalePurchases, sweepPackages } from '@kinetic/core';
import { withSystem } from '@kinetic/db';
import { defineJob } from './registry';

export const BILLING_SWEEP = 'billing.sweep';
/** pg-boss cron: hourly. */
export const BILLING_SWEEP_CRON = '23 * * * *';

/**
 * D-013: expires checkouts nobody finished (giving back reserved coupon uses), then sends renewal notices and
 * ends packages whose access ran out (J4, J6). Hourly, so a notice goes out within the hour it falls due.
 */
export const billingSweepJob = defineJob<object>({
  name: BILLING_SWEEP,
  cron: BILLING_SWEEP_CRON,
  async handle(_data, deps) {
    const expired = await withSystem((tx) => expireStalePurchases(tx), deps.prisma);
    if (expired > 0) deps.logger.info({ expired }, 'stale checkouts expired');
    const { notified, ended } = await sweepPackages(deps.prisma);
    if (notified + ended > 0) deps.logger.info({ notified, ended }, 'package renewals swept');
  },
});
