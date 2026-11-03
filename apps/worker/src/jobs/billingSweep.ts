import { expireStalePurchases } from '@kinetic/core';
import { withSystem } from '@kinetic/db';
import { defineJob } from './registry';

export const BILLING_SWEEP = 'billing.sweep';
/** pg-boss cron: hourly. */
export const BILLING_SWEEP_CRON = '23 * * * *';

/** D-013: expires checkouts nobody finished (giving back reserved coupon uses). */
export const billingSweepJob = defineJob<object>({
  name: BILLING_SWEEP,
  cron: BILLING_SWEEP_CRON,
  async handle(_data, deps) {
    const expired = await withSystem((tx) => expireStalePurchases(tx), deps.prisma);
    if (expired > 0) deps.logger.info({ expired }, 'stale checkouts expired');
  },
});
