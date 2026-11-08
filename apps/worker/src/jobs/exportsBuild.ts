import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claimExport,
  completeExport,
  exportFileKeys,
  failExport,
  type ExportTxRunner,
  type Logger,
} from '@repsy/core';
import { withSystem, withTenant, type PrismaClient } from '@repsy/db';
import { createStorage, type StoragePort } from '@repsy/storage';
import { defineJob } from './registry';

export const EXPORTS_BUILD = 'exports.build';
/** pg-boss cron: every minute (exports should be ready soon after the request). */
export const EXPORTS_BUILD_CRON = '* * * * *';
const BATCH = 10;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Builds queued exports (S5-2). Each job: claim in its own tenant transaction (so the attempt count sticks), then
 * `completeExport` (read transaction, storage writes outside any transaction, short `done` transaction), and on
 * failure `failExport` (retry, or `failed` after the last attempt). A failed build removes what it wrote; a build
 * whose claim was lost (an erasure re-queued it) is neither done nor failed.
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
    const run: ExportTxRunner = (fn, opts) =>
      withTenant(organizationId, fn, prisma, { timeout: opts?.timeout });
    try {
      if (await completeExport(run, organizationId, job, storage, now)) result.done += 1;
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

const PURGE_BATCH = 50;

/**
 * Removes the files of exports past their expiry from storage (PR #2 review D-I4): exports offered for their 7 days,
 * and exports an erasure expired at once. The keys stay on the row until storage confirms, so a failure is retried on
 * the next run; `purgedAt` then marks it done. Never content in logs: which job and the error class.
 */
export async function purgeExpiredExports(
  prisma: PrismaClient,
  storage: StoragePort,
  now: Date,
  logger?: Pick<Logger, 'error'>,
): Promise<{ purged: number; failed: number }> {
  const due = await withSystem(
    (tx) =>
      tx.exportJob.findMany({
        where: { status: 'done', purgedAt: null, expiresAt: { lte: now } },
        orderBy: { expiresAt: 'asc' },
        take: PURGE_BATCH,
        select: { id: true, filesJson: true },
      }),
    prisma,
  );
  const result = { purged: 0, failed: 0 };
  for (const job of due) {
    try {
      await storage.deleteMany(exportFileKeys(job.filesJson));
      await withSystem(
        (tx) => tx.exportJob.updateMany({ where: { id: job.id }, data: { purgedAt: now } }),
        prisma,
      );
      result.purged += 1;
    } catch (error) {
      result.failed += 1;
      logger?.error(
        { exportJobId: job.id, errName: error instanceof Error ? error.name : 'unknown' },
        'export files not removed',
      );
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
    const now = new Date();
    const r = await buildExports(deps.prisma, storage, now, deps.logger);
    if (r.done + r.retried + r.failed > 0) deps.logger.info(r, 'exports built');
    const p = await purgeExpiredExports(deps.prisma, storage, now, deps.logger);
    if (p.purged + p.failed > 0) deps.logger.info(p, 'expired exports purged');
  },
});
