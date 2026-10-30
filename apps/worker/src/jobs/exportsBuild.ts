import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimExport, completeExport, failExport, type Logger } from '@kinetic/core';
import { withSystem, withTenant, type PrismaClient } from '@kinetic/db';
import { createStorage, type StoragePort } from '@kinetic/storage';
import { defineJob } from './registry';

export const EXPORTS_BUILD = 'exports.build';
/** pg-boss cron: every minute (exports should be ready soon after the request). */
export const EXPORTS_BUILD_CRON = '* * * * *';
const BATCH = 10;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Builds queued exports (S5-2). Each job runs in three tenant transactions: claim (so the attempt count sticks),
 * build + record `done`, and on failure `failExport` (retry, or `failed` after the last attempt). Storage writes
 * happen before `done` is recorded, and a failed build removes what it wrote.
 */
export async function buildExports(
  prisma: PrismaClient,
  storage: StoragePort,
  now: Date,
  logger?: Pick<Logger, 'error'>,
): Promise<{ done: number; retried: number; failed: number }> {
  const due = await withSystem(
    (tx) =>
      tx.exportJob.findMany({
        where: {
          OR: [
            { status: 'queued' },
            { status: 'running', claimedAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
          ],
        },
        orderBy: { createdAt: 'asc' },
        take: BATCH,
        select: { id: true, organizationId: true },
      }),
    prisma,
  );
  const result = { done: 0, retried: 0, failed: 0 };
  for (const { id, organizationId } of due) {
    const job = await withTenant(organizationId, (tx) => claimExport(tx, id, now), prisma);
    if (!job) continue;
    try {
      await withTenant(
        organizationId,
        (tx) => completeExport(tx, organizationId, job, storage, now),
        prisma,
      );
      result.done += 1;
    } catch (error) {
      // Never the export's content: just which job and the error class.
      logger?.error(
        { exportJobId: id, errName: error instanceof Error ? error.name : 'unknown' },
        'export build failed',
      );
      const outcome = await withTenant(organizationId, (tx) => failExport(tx, job), prisma);
      if (outcome === 'failed') result.failed += 1;
      else result.retried += 1;
    }
  }
  return result;
}

let storage: StoragePort | undefined;

export const exportsBuildJob = defineJob<object>({
  name: EXPORTS_BUILD,
  cron: EXPORTS_BUILD_CRON,
  async handle(_data, deps) {
    storage ??= createStorage(process.env, repoRoot);
    const r = await buildExports(deps.prisma, storage, new Date(), deps.logger);
    if (r.done + r.retried + r.failed > 0) deps.logger.info(r, 'exports built');
  },
});
