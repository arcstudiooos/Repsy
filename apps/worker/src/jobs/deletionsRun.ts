import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eraseClientData, type Logger } from '@kinetic/core';
import { withSystem, type PrismaClient } from '@kinetic/db';
import { createStorage, type StoragePort } from '@kinetic/storage';
import { defineJob } from './registry';

export const DELETIONS_RUN = 'deletions.run';
/** pg-boss cron: every minute (a verified request runs soon after the admin's decision). */
export const DELETIONS_RUN_CRON = '* * * * *';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Runs verified deletion requests not on legal hold (S5-3). Each runs in its own system transaction
 * (`eraseClientData` is idempotent: a done request is skipped). The client's export files are removed from storage
 * after the database commit.
 */
export async function runDeletions(
  prisma: PrismaClient,
  storage: StoragePort,
  now: Date,
  logger?: Pick<Logger, 'error'>,
): Promise<{ done: number; held: number }> {
  const due = await withSystem(
    (tx) =>
      tx.deletionRequest.findMany({
        where: { status: 'verified', legalHold: false },
        orderBy: { verifiedAt: 'asc' },
        take: 10,
        select: { id: true },
      }),
    prisma,
  );
  const result = { done: 0, held: 0 };
  for (const { id } of due) {
    const r = await withSystem((tx) => eraseClientData(tx, id, now), prisma);
    if (r.status === 'held') result.held += 1;
    if (r.status !== 'done') continue;
    result.done += 1;
    try {
      await storage.deleteMany(r.storageKeys);
    } catch (error) {
      logger?.error(
        { deletionRequestId: id, errName: error instanceof Error ? error.name : 'unknown' },
        'export files not removed',
      );
    }
  }
  return result;
}

let storage: StoragePort | undefined;

export const deletionsRunJob = defineJob<object>({
  name: DELETIONS_RUN,
  cron: DELETIONS_RUN_CRON,
  async handle(_data, deps) {
    storage ??= createStorage(process.env, repoRoot);
    const r = await runDeletions(deps.prisma, storage, new Date(), deps.logger);
    if (r.done > 0) deps.logger.info(r, 'deletions run');
  },
});
