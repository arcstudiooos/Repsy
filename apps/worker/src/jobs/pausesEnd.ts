import { endDuePause, todayInZone } from '@kinetic/core';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { defineJob } from './registry';

export const PAUSES_END = 'pauses.end';
/** pg-boss cron: every 10 minutes. */
export const PAUSES_END_CRON = '*/10 * * * *';

const DAY_MS = 86_400_000;

/**
 * Ends every open pause whose resume date has arrived in its client's zone (S3-5, Ruling 6). The scan is a system
 * read; each pause is ended in its own organization's tenant transaction by `endDuePause`, which re-checks under the
 * client lock, so overlapping or repeated runs end a pause once and never move a session.
 */
export async function endDuePauses(prisma: PrismaClient, now: Date): Promise<{ ended: number }> {
  // No zone is more than a day ahead of UTC, so this bound only narrows the scan; the zone check below decides.
  const horizon = new Date(now.getTime() + DAY_MS);
  const open = await withSystem(
    (tx) =>
      tx.clientPause.findMany({
        where: { endedAt: null, resumeLocalDate: { lte: horizon } },
        select: {
          organizationId: true,
          clientId: true,
          resumeLocalDate: true,
          client: { select: { timezone: true } },
        },
      }),
    prisma,
  );
  let ended = 0;
  for (const p of open) {
    if (p.resumeLocalDate.toISOString().slice(0, 10) > todayInZone(p.client.timezone, now)) {
      continue;
    }
    const done = await withTenant(
      p.organizationId,
      (tx) => endDuePause(tx, p.organizationId, p.clientId, now),
      prisma,
    );
    if (done) ended += 1;
  }
  return { ended };
}

export const pausesEndJob = defineJob<object>({
  name: PAUSES_END,
  cron: PAUSES_END_CRON,
  async handle(_data, deps) {
    const { ended } = await endDuePauses(deps.prisma, new Date());
    if (ended > 0) deps.logger.info({ ended }, 'pauses ended');
  },
});
