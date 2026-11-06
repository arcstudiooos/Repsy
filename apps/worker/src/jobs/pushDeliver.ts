import { deliverPushes } from '@kinetic/core';
import { withSystem } from '@kinetic/db';
import { defineJob } from './registry';

export const PUSH_DELIVER = 'push.deliver';
/** pg-boss cron: every minute (PRD H11). Does nothing while VAPID keys are unset. */
export const PUSH_DELIVER_CRON = '* * * * *';

/** A push with no payload: the push service needs only the VAPID header (D-011 #6). */
async function send(endpoint: string, headers: Record<string, string>): Promise<number> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    // Never follow a redirect off the push service (core only stores allowlisted push-service endpoints).
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  return res.status;
}

export const pushDeliverJob = defineJob<object>({
  name: PUSH_DELIVER,
  cron: PUSH_DELIVER_CRON,
  async handle(_data, deps) {
    const { sent, dropped } = await deliverPushes((fn) => withSystem(fn, deps.prisma), send);
    if (sent > 0 || dropped > 0) deps.logger.info({ sent, dropped }, 'pushes delivered');
  },
});
