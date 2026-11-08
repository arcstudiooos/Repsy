import {
  eraseClientData,
  ERASURE_TIMEOUT_MS,
  recordErasureFailure,
  type Logger,
} from '@repsy/core';
import { withSystem, type PrismaClient } from '@repsy/db';
import { defineJob, type CaptureException } from './registry';

export const DELETIONS_RUN = 'deletions.run';
/** pg-boss cron: every minute (a verified request runs soon after the admin's decision). */
export const DELETIONS_RUN_CRON = '* * * * *';

/**
 * Runs verified deletion requests not on legal hold (S5-3). Each runs in its own system transaction
 * (`eraseClientData` is idempotent: a done request is skipped). A failing request is recorded and reported, and the
 * run continues with the next one; requests that failed before run after untried ones, so one bad request cannot
 * block the queue (PR #2 review C-I1). Export files are removed by the export sweep, not here (D-I4).
 */
export async function runDeletions(
  prisma: PrismaClient,
  now: Date,
  logger?: Pick<Logger, 'error'>,
  captureException?: CaptureException,
): Promise<{ done: number; held: number; failed: number }> {
  const due = await withSystem(
    (tx) =>
      tx.deletionRequest.findMany({
        where: { status: 'verified', legalHold: false },
        orderBy: [{ attempts: 'asc' }, { verifiedAt: 'asc' }],
        take: 10,
        select: { id: true },
      }),
    prisma,
  );
  const result = { done: 0, held: 0, failed: 0 };
  for (const { id } of due) {
    try {
      const r = await withSystem((tx) => eraseClientData(tx, id, now), prisma, {
        timeout: ERASURE_TIMEOUT_MS,
      });
      if (r.status === 'held') result.held += 1;
      if (r.status === 'done') result.done += 1;
    } catch (error) {
      result.failed += 1;
      const errName = error instanceof Error ? error.name : 'unknown';
      // Never content (a database error can quote row values): which request and the error class.
      logger?.error({ deletionRequestId: id, errName }, 'erasure failed');
      captureException?.(new Error(`erasure failed: ${errName}`), { deletionRequestId: id });
      await withSystem((tx) => recordErasureFailure(tx, id, errName), prisma).catch(
        () => undefined,
      );
    }
  }
  return result;
}

export const deletionsRunJob = defineJob<object>({
  name: DELETIONS_RUN,
  cron: DELETIONS_RUN_CRON,
  async handle(_data, deps) {
    const r = await runDeletions(deps.prisma, new Date(), deps.logger, deps.captureException);
    if (r.done + r.failed > 0) deps.logger.info(r, 'deletions run');
  },
});
